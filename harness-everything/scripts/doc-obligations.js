'use strict';

const lifecycle = require('./doc-lifecycle');

const CATALOG = Object.freeze([
  { capability: 'doc-lint', strength: 'MUST', scope: 'Changed governed documents', acceptance: 'Run document lifecycle lint for every changed governed document.' },
  { capability: 'link-check', strength: 'MUST', scope: 'Changed governed documents', acceptance: 'Check in-repository links for every changed governed document.' },
  { capability: 'update-over-create', strength: 'SHOULD', scope: 'New governed documents', acceptance: 'Confirm an existing document could not be updated instead.' },
  { capability: 'outline-confirmation', strength: 'SHOULD', scope: 'New governed documents', acceptance: 'Confirm the new document outline before drafting.' },
  { capability: 'derived-regenerate', strength: 'MUST', scope: 'Affected declared derived views', acceptance: 'Regenerate the affected view and confirm it matches its source.' },
  { capability: 'quality-review', strength: 'MUST', scope: 'Normative document changes', acceptance: 'Review changes to normative document fields and content.' },
  { capability: 'conflict-check', strength: 'MUST', scope: 'Normative document changes', acceptance: 'Check normative changes for conflicts with current project documents.' },
  { capability: 'prose-reminder', strength: 'SHOULD', scope: 'Changed governed reference content', acceptance: 'Review the prose-to-structure reminder for reference content.' },
  { capability: 'requirement-sync', strength: 'MUST', scope: 'Code changes or changed REQ-citing tests', acceptance: 'Evaluate whether affected requirements need an update or supported no-change record.' }
]);

const CODE_EXTENSION = /\.(?:c|cc|cpp|h|hpp|m|mm|go|rs|java|kt|swift|js|jsx|mjs|cjs|ts|tsx|py|rb|php|sh|ps1|sql)$/i;
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|(?:^|\/)[^/]*(?:\.test|\.spec)\.[^/]+$/i;
const REQUIREMENT_ID = /\bREQ-[A-Z][A-Z0-9]{1,9}-\d{3,}\b/;
const REQUIREMENT_IDS = /\b(REQ-[A-Z][A-Z0-9]{1,9}-\d{3,})\b/g;
const DOCUMENT_NORMATIVE_FIELDS = ['status', 'supersedes'];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function snapshotFiles(snapshot) {
  const source = snapshot && snapshot.files && typeof snapshot.files === 'object' ? snapshot.files : {};
  const files = {};
  for (const path of Object.keys(source).sort(compareText)) {
    if (typeof source[path] === 'string') files[normalizePath(path)] = source[path];
  }
  return files;
}

function isSnapshotInput(snapshot) {
  return Boolean(snapshot && snapshot.files && typeof snapshot.files === 'object' && !Array.isArray(snapshot.files)
    && Object.values(snapshot.files).every(text => typeof text === 'string'));
}

function isConfigInput(config) {
  return Boolean(config && typeof config === 'object' && !Array.isArray(config));
}

function globToRegExp(glob) {
  const source = normalizePath(glob);
  let pattern = '^';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '*' && source[index + 1] === '*') {
      if (source[index + 2] === '/') {
        pattern += '(?:.*/)?';
        index += 2;
      } else {
        pattern += '.*';
        index++;
      }
    } else if (char === '*') {
      pattern += '[^/]*';
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`);
}

function matchesAny(path, globs) {
  return Array.isArray(globs) && globs.some(glob => typeof glob === 'string' && globToRegExp(glob).test(path));
}

function governedEntry(path, config) {
  const entries = Array.isArray(config && config.governed) ? config.governed : [];
  return entries.find(entry => entry && typeof entry.path === 'string' && globToRegExp(entry.path).test(path)) || null;
}

function parsedDocument(path, text, config) {
  const parsed = lifecycle.parseFrontmatter(text);
  const entry = governedEntry(path, config);
  const legacy = matchesAny(path, config && config.legacy);
  return {
    path,
    role: entry && typeof entry.role === 'string' ? entry.role : parsed.data && parsed.data.role || null,
    legacy,
    frontmatter: parsed.data,
    body: parsed.body,
    error: parsed.error,
    storedBytes: Buffer.from(text, 'utf8')
  };
}

function analyzeSnapshot(files, config) {
  const docs = Object.keys(files).sort(compareText).map(path => parsedDocument(path, files[path], config));
  const analysis = lifecycle.analyzeDocs(docs, config, { all: true });
  return { diagnostics: analysis.diagnostics, evidence: analysis.evidence };
}

function findRenames(base, candidate) {
  const oldOnly = Object.keys(base).filter(path => !Object.prototype.hasOwnProperty.call(candidate, path)).sort(compareText);
  const newOnly = Object.keys(candidate).filter(path => !Object.prototype.hasOwnProperty.call(base, path)).sort(compareText);
  const destinations = new Map();
  for (const path of newOnly) {
    const text = candidate[path];
    if (!destinations.has(text)) destinations.set(text, []);
    destinations.get(text).push(path);
  }
  const moves = [];
  const consumedNew = new Set();
  const consumedOld = new Set();
  for (const from of oldOnly) {
    const matches = destinations.get(base[from]);
    const to = matches && matches.find(path => !consumedNew.has(path));
    if (!to) continue;
    moves.push({ kind: 'rename', from, to, baseText: base[from], candidateText: candidate[to] });
    consumedOld.add(from);
    consumedNew.add(to);
  }
  const changes = [...moves];
  for (const path of Object.keys(base).sort(compareText)) {
    if (Object.prototype.hasOwnProperty.call(candidate, path) && base[path] !== candidate[path]) {
      changes.push({ kind: 'modified', path, baseText: base[path], candidateText: candidate[path] });
    }
  }
  for (const path of oldOnly) {
    if (!consumedOld.has(path)) changes.push({ kind: 'deleted', path, baseText: base[path] });
  }
  for (const path of newOnly) {
    if (!consumedNew.has(path)) changes.push({ kind: 'added', path, candidateText: candidate[path] });
  }
  return changes.sort((left, right) => compareText(left.to || left.path || left.from, right.to || right.path || right.from)
    || compareText(left.kind, right.kind));
}

function changePaths(change) {
  return change.kind === 'rename' ? [change.from, change.to] : [change.path];
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => typeof value === 'string'))].sort(compareText);
}

function textAt(files, path) {
  return path && Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
}

function roleAt(path, text, config) {
  const entry = governedEntry(path, config);
  if (entry && typeof entry.role === 'string') return entry.role;
  if (text !== undefined) {
    const parsed = lifecycle.parseFrontmatter(text);
    if (parsed.data && typeof parsed.data.role === 'string') return parsed.data.role;
  }
  return null;
}

function isGoverned(path, text, config) {
  return Boolean(governedEntry(path, config)) || matchesAny(path, config && config.legacy)
    || Boolean(roleAt(path, text, config));
}

function extractSection(text, wantedTitle) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim() });
  }
  const found = headings.filter(item => item.title.toLowerCase() === wantedTitle.toLowerCase());
  if (found.length > 1) return { state: 'unknown', text: '' };
  if (!found.length) return { state: 'absent', text: '' };
  const heading = found[0];
  const next = headings.find(item => item.index > heading.index && item.level <= heading.level);
  const end = next ? next.index : lines.length;
  return { state: 'present', text: lines.slice(heading.index + 1, end).join('\n').trim() };
}

function requirementProjection(item) {
  return {
    id: item.id,
    title: item.title,
    block: item.block,
    aliases: Array.isArray(item.aliases) ? [...item.aliases] : [],
    replaces: Array.isArray(item.replaces) ? [...item.replaces] : [],
    validClause: item.validClause === true
  };
}

function extractRequirementBlocks(text) {
  if (text === undefined) return [];
  const parsed = lifecycle.parseFrontmatter(text);
  if (parsed.error) return [];
  return lifecycle.parseRequirementBlocks({ body: parsed.body }).map(requirementProjection);
}

function requirementDeclarations(files, config) {
  const declarations = [];
  for (const path of Object.keys(files).sort(compareText)) {
    const text = files[path];
    if (roleAt(path, text, config) !== 'prd') continue;
    const parsed = lifecycle.parseFrontmatter(text);
    if (parsed.error) continue;
    for (const item of lifecycle.parseRequirementBlocks({ body: parsed.body })) {
      const projection = requirementProjection(item);
      declarations.push({ ...projection, file: path, text: JSON.stringify(projection) });
    }
  }
  return declarations;
}

function compareRequirementBlocks(beforeReqs, afterReqs) {
  const byId = requirements => {
    const result = new Map();
    for (const item of requirements) {
      if (!result.has(item.id)) result.set(item.id, []);
      result.get(item.id).push(item);
    }
    return result;
  };
  const beforeById = byId(beforeReqs);
  const afterById = byId(afterReqs);
  const ids = uniqueSorted([...beforeById.keys(), ...afterById.keys()]);
  let changed = false;
  let unknown = false;
  for (const id of ids) {
    const before = beforeById.get(id) || [];
    const after = afterById.get(id) || [];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if ([...before, ...after].some(item => item.validClause !== true)) unknown = true;
    else changed = true;
  }
  return changed ? 'changed' : unknown ? 'unknown' : 'same';
}

function changedRequirementFacts(baseFiles, candidateFiles, config) {
  const beforeById = new Map();
  for (const item of requirementDeclarations(baseFiles, config)) {
    if (!beforeById.has(item.id)) beforeById.set(item.id, []);
    beforeById.get(item.id).push(item);
  }
  return requirementDeclarations(candidateFiles, config).filter(item => {
    const priorItems = beforeById.get(item.id) || [];
    const prior = priorItems.find(candidate => candidate.file === item.file) || priorItems[0];
    return !prior || prior.text !== item.text;
  }).map(({ id, file }) => ({ id, file }))
    .sort((left, right) => compareText(left.id, right.id) || compareText(left.file, right.file));
}

function citedRequirementFacts(changes, baseFiles, candidateFiles, config) {
  const citedIds = new Set();
  for (const change of changes) {
    if (!change.testWithRequirement) continue;
    const oldPath = change.kind === 'rename' ? change.from : change.path;
    const newPath = change.kind === 'rename' ? change.to : change.path;
    for (const text of [textAt(baseFiles, oldPath), textAt(candidateFiles, newPath)]) {
      for (const match of String(text || '').matchAll(REQUIREMENT_IDS)) citedIds.add(match[1]);
    }
  }

  const before = requirementDeclarations(baseFiles, config);
  const after = requirementDeclarations(candidateFiles, config);
  const result = [];
  for (const id of [...citedIds].sort(compareText)) {
    const candidateFilesForId = uniqueSorted(after.filter(item => item.id === id).map(item => item.file));
    const filesForId = candidateFilesForId.length
      ? candidateFilesForId
      : uniqueSorted(before.filter(item => item.id === id).map(item => item.file));
    if (filesForId.length) for (const file of filesForId) result.push({ id, file });
    else result.push({ id, file: null });
  }
  return result;
}

function derivedOutputPaths(changes, config) {
  const entries = Array.isArray(config && config.derived) ? config.derived : [];
  const paths = [];
  for (const item of entries) {
    if (!item || typeof item.path !== 'string') continue;
    const changedPaths = changes.filter(change => change.contentChanged).flatMap(changePaths);
    const outputChanged = changedPaths.some(path => globToRegExp(item.path).test(path));
    const sources = [item.source, ...(Array.isArray(item.sources) ? item.sources : [])]
      .filter(source => typeof source === 'string');
    const sourceChanged = changedPaths.some(path => sources.some(source => globToRegExp(source).test(path)));
    if (outputChanged || sourceChanged) paths.push(item.path);
  }
  return uniqueSorted(paths);
}

function normalizedFields(text) {
  if (text === undefined) return { state: 'absent', values: {} };
  const parsed = lifecycle.parseFrontmatter(text);
  return { state: parsed.error ? 'unknown' : 'present', values: parsed.data || {} };
}

function fieldsChanged(beforeText, afterText) {
  const before = normalizedFields(beforeText);
  const after = normalizedFields(afterText);
  if (before.state === 'unknown' || after.state === 'unknown') return 'unknown';
  return DOCUMENT_NORMATIVE_FIELDS.some(key => {
    const hasBefore = Object.prototype.hasOwnProperty.call(before.values, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(after.values, key);
    return hasBefore !== hasAfter || JSON.stringify(before.values[key]) !== JSON.stringify(after.values[key]);
  }) ? 'changed' : 'same';
}

function normativeState(change, before, after, oldRole, newRole) {
  const role = newRole || oldRole;
  if (role !== 'prd' && role !== 'adr') return 'none';
  const fieldState = fieldsChanged(before, after);
  if (fieldState === 'changed') return 'changed';
  if (fieldState === 'unknown') return 'unknown';

  if (role === 'prd') {
    const beforeReqs = extractRequirementBlocks(before);
    const afterReqs = extractRequirementBlocks(after);
    const reqState = compareRequirementBlocks(beforeReqs, afterReqs);
    if (reqState !== 'same') return reqState;
    const hasIncompleteReqHeading = [before, after].some(text => text !== undefined
      && /^#{1,6}\s+REQ(?:\b|[-\s])/m.test(text)
      && !REQUIREMENT_ID.test(text));
    return hasIncompleteReqHeading ? 'unknown' : 'none';
  }

  const priorDecision = before === undefined ? { state: 'absent', text: '' } : extractSection(before, 'Decision');
  const nextDecision = after === undefined ? { state: 'absent', text: '' } : extractSection(after, 'Decision');
  if (priorDecision.state === 'unknown' || nextDecision.state === 'unknown') return 'unknown';
  if (priorDecision.state === 'present' && nextDecision.state === 'absent') {
    return change.kind === 'deleted' ? 'changed' : 'unknown';
  }
  if (priorDecision.state !== nextDecision.state || priorDecision.text !== nextDecision.text) return 'changed';
  return 'none';
}

function deriveDocFacts({ base, candidate, config } = {}) {
  const inputKnown = isSnapshotInput(base) && isSnapshotInput(candidate) && isConfigInput(config);
  const effectiveConfig = isConfigInput(config) ? config : {};
  const baseFiles = snapshotFiles(base);
  const candidateFiles = snapshotFiles(candidate);
  const changes = findRenames(baseFiles, candidateFiles);
  const contextualChanges = changes.map(change => {
    const oldPath = change.kind === 'rename' ? change.from : change.path;
    const newPath = change.kind === 'rename' ? change.to : change.path;
    const beforeText = textAt(baseFiles, oldPath);
    const afterText = textAt(candidateFiles, newPath);
    const oldRole = roleAt(oldPath, beforeText, effectiveConfig);
    const newRole = roleAt(newPath, afterText, effectiveConfig);
    const oldGoverned = isGoverned(oldPath, beforeText, effectiveConfig);
    const newGoverned = isGoverned(newPath, afterText, effectiveConfig);
    const contentChanged = change.kind !== 'rename' && beforeText !== afterText;
    const paths = changePaths(change);
    return {
      ...change,
      oldPath,
      newPath,
      oldRole,
      newRole,
      oldGoverned,
      newGoverned,
      contentChanged,
      normative: contentChanged ? normativeState(change, beforeText, afterText, oldRole, newRole) : 'none',
      derivedAffected: contentChanged && (effectiveConfig && Array.isArray(effectiveConfig.derived) ? effectiveConfig.derived : [])
        .some(item => item && typeof item.path === 'string' && paths.some(path => globToRegExp(item.path).test(path)))
        || contentChanged && (effectiveConfig && Array.isArray(effectiveConfig.derived) ? effectiveConfig.derived : [])
          .some(item => item && (typeof item.source === 'string' && paths.some(path => globToRegExp(item.source).test(path))
            || Array.isArray(item.sources) && item.sources.some(source => typeof source === 'string' && paths.some(path => globToRegExp(source).test(path))))),
      testWithRequirement: contentChanged && paths.some(path => TEST_PATH.test(path))
        && REQUIREMENT_ID.test(`${beforeText || ''}\n${afterText || ''}`),
      codeChanged: contentChanged && paths.some(path => CODE_EXTENSION.test(path) && !TEST_PATH.test(path)
        && !isGoverned(path, textAt(baseFiles, path) ?? textAt(candidateFiles, path), effectiveConfig))
    };
  });

  const governedTouched = contextualChanges.some(change => change.oldGoverned || change.newGoverned);
  const newGovernedFiles = contextualChanges.filter(change => change.kind === 'added' && change.newGoverned);
  const normativeChanged = contextualChanges.some(change => change.normative === 'changed');
  const normativeUnknown = !normativeChanged && contextualChanges.some(change => change.normative === 'unknown');
  const referenceContentChanged = contextualChanges.some(change => change.contentChanged
    && [change.oldRole, change.newRole].includes('reference')
    && (change.oldGoverned || change.newGoverned));
  const requirementSyncCandidate = contextualChanges.some(change => change.testWithRequirement);
  const codeChanged = contextualChanges.some(change => change.codeChanged);
  const derivedAffected = contextualChanges.some(change => change.derivedAffected);
  const reqUpdates = changedRequirementFacts(baseFiles, candidateFiles, effectiveConfig);
  const citedReqs = citedRequirementFacts(contextualChanges, baseFiles, candidateFiles, effectiveConfig);
  const derivedPaths = derivedOutputPaths(contextualChanges, effectiveConfig);
  const baseAnalysis = analyzeSnapshot(baseFiles, effectiveConfig);
  const candidateAnalysis = analyzeSnapshot(candidateFiles, effectiveConfig);

  const facts = {
    schemaVersion: 1,
    inputKnown,
    changedPaths: {
      added: contextualChanges.filter(change => change.kind === 'added').map(change => change.path).sort(compareText),
      modified: contextualChanges.filter(change => change.kind === 'modified').map(change => change.path).sort(compareText),
      deleted: contextualChanges.filter(change => change.kind === 'deleted').map(change => change.path).sort(compareText),
      renamed: contextualChanges.filter(change => change.kind === 'rename')
        .map(change => ({ from: change.from, to: change.to }))
        .sort((left, right) => compareText(left.from, right.from) || compareText(left.to, right.to))
    },
    reqCitingTests: uniqueSorted(contextualChanges.filter(change => change.testWithRequirement)
      .map(change => candidateFiles[change.newPath] !== undefined ? change.newPath : change.oldPath)),
    reqUpdates,
    citedReqs,
    changes: contextualChanges.map(change => ({
      kind: change.kind,
      ...(change.path ? { path: change.path } : {}),
      ...(change.from ? { from: change.from } : {}),
      ...(change.to ? { to: change.to } : {}),
      oldRole: change.oldRole,
      newRole: change.newRole,
      oldGoverned: change.oldGoverned,
      newGoverned: change.newGoverned,
      contentChanged: change.contentChanged,
      normative: change.normative,
      derivedAffected: change.derivedAffected,
      testWithRequirement: change.testWithRequirement,
      codeChanged: change.codeChanged
    })),
    governedTouched,
    governedPaths: uniqueSorted(contextualChanges.filter(change => change.oldGoverned || change.newGoverned)
      .flatMap(changePaths)),
    newGovernedPaths: newGovernedFiles.map(change => change.newPath).sort(compareText),
    derivedAffected,
    derivedPaths,
    normativeChanged,
    normativeUnknown,
    normativePaths: uniqueSorted(contextualChanges.filter(change => change.normative === 'changed' || change.normative === 'unknown')
      .flatMap(changePaths)),
    referenceContentChanged,
    referencePaths: uniqueSorted(contextualChanges.filter(change => change.contentChanged
      && [change.oldRole, change.newRole].includes('reference')
      && (change.oldGoverned || change.newGoverned)).flatMap(changePaths)),
    codeChanged,
    codePaths: uniqueSorted(contextualChanges.filter(change => change.codeChanged).flatMap(changePaths)),
    requirementSyncCandidate,
    documentAnalysis: { base: baseAnalysis, candidate: candidateAnalysis }
  };
  const provenance = {
    source: 'base/candidate file snapshots',
    changes: contextualChanges.map(change => change.kind === 'rename'
      ? { kind: 'rename', from: change.from, to: change.to }
      : { kind: change.kind, path: change.path })
  };
  return { facts, provenance };
}

function deriveDocObligations(facts) {
  const validFacts = Boolean(facts && facts.schemaVersion === 1 && facts.inputKnown === true);
  const applicable = new Set();
  const unknown = new Set();
  const strengths = new Map();
  if (!validFacts) {
    for (const { capability } of CATALOG) unknown.add(capability);
  } else {
    if (facts.governedTouched) {
      applicable.add('doc-lint');
      applicable.add('link-check');
    }
    if (facts.newGovernedPaths.length) {
      applicable.add('update-over-create');
      applicable.add('outline-confirmation');
      const newRoles = facts.changes.filter(change => change.kind === 'added' && facts.newGovernedPaths.includes(change.path))
        .map(change => change.newRole);
      if (newRoles.some(role => role === 'prd' || role === 'adr')) strengths.set('outline-confirmation', 'MUST');
      else if (newRoles.some(role => !role || !['reference', 'ticket', 'log', 'report'].includes(role))) {
        unknown.add('outline-confirmation');
        strengths.set('outline-confirmation', 'MUST');
      }
    }
    if (facts.derivedAffected) applicable.add('derived-regenerate');
    if (facts.normativeChanged) {
      applicable.add('quality-review');
      applicable.add('conflict-check');
    } else if (facts.normativeUnknown) {
      unknown.add('quality-review');
      unknown.add('conflict-check');
    }
    if (facts.referenceContentChanged) applicable.add('prose-reminder');
    if (facts.requirementSyncCandidate) applicable.add('requirement-sync');
    else if (facts.codeChanged) unknown.add('requirement-sync');
  }

  const scopePaths = {
    'doc-lint': validFacts ? facts.governedPaths || [] : [],
    'link-check': validFacts ? facts.governedPaths || [] : [],
    'update-over-create': validFacts ? facts.newGovernedPaths || [] : [],
    'outline-confirmation': validFacts ? facts.newGovernedPaths || [] : [],
    'derived-regenerate': validFacts ? facts.derivedPaths || [] : [],
    'quality-review': validFacts ? facts.normativePaths || [] : [],
    'conflict-check': validFacts ? facts.normativePaths || [] : [],
    'prose-reminder': validFacts ? facts.referencePaths || [] : [],
    'requirement-sync': validFacts ? uniqueSorted([...(facts.codePaths || []), ...(facts.reqCitingTests || []),
      ...(facts.citedReqs || []).map(item => item && item.file)]) : []
  };
  const requirementFacts = validFacts && Array.isArray(facts.citedReqs) && Array.isArray(facts.reqUpdates)
    ? { citedReqs: facts.citedReqs, reqUpdates: facts.reqUpdates }
    : {};
  return CATALOG.map(item => ({
    id: `doc-change:${item.capability}`,
    capability: item.capability,
    strength: strengths.get(item.capability) || item.strength,
    applicability: applicable.has(item.capability) ? 'applicable' : unknown.has(item.capability) ? 'unknown' : 'N/A',
    scope: { paths: uniqueSorted(scopePaths[item.capability] || []) },
    acceptance: item.acceptance,
    ...(item.capability === 'requirement-sync' ? requirementFacts : {})
  }));
}

module.exports = { deriveDocFacts, deriveDocObligations };
