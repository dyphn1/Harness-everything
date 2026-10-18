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
const MAX_LINE_DIFF_CELLS = 2_000_000;
const DOCUMENT_NORMATIVE_FIELDS = ['status', 'supersedes'];
const INVENTORY_ENVELOPE_FIELDS = [
  'complete',
  'waiverInventoryComplete',
  'baseDigest',
  'candidateDigest',
  'configDigest'
];

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

function copyInventoryEnvelope(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return undefined;
  const envelope = {};
  for (const field of INVENTORY_ENVELOPE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(inventory, field)) envelope[field] = inventory[field];
  }
  return envelope;
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

function analyzeSnapshotWithLifecycle(files, config) {
  const docs = Object.keys(files).sort(compareText).map(path => parsedDocument(path, files[path], config));
  const analysis = lifecycle.analyzeDocs(docs, config, { all: true });
  return {
    docs,
    analysis,
    summary: { diagnostics: analysis.diagnostics, evidence: analysis.evidence }
  };
}

function analyzeSnapshot(files, config) {
  return analyzeSnapshotWithLifecycle(files, config).summary;
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

const REGEX_PREFIX_KEYWORDS = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw',
  'typeof', 'void', 'yield'
]);
const MULTI_CHAR_TOKENS = [
  '>>>=', '===', '!==', '**=', '&&=', '||=', '??=', '>>>', '<<=', '>>=', '...', '=>', '==', '!=',
  '<=', '>=', '++', '--', '**', '&&', '||', '??', '?.', '+=', '-=', '*=', '/=', '%=', '&=', '|=',
  '^=', '<<', '>>'
];

function tokenizeTestSource(text) {
  const source = String(text || '');
  const tokens = [];
  let index = 0;
  let line = 0;
  let canStartRegex = true;
  let valid = true;

  const push = (type, value, tokenLine = line) => tokens.push({ type, value, line: tokenLine });
  const bumpLine = char => {
    if (char === '\n' || (char === '\r' && source[index + 1] !== '\n')) line++;
  };
  const skipEscapedChar = () => {
    const escaped = source[index + 1];
    if (escaped === '\r' && source[index + 2] === '\n') {
      line++;
      index += 3;
    } else {
      bumpLine(escaped);
      index += 2;
    }
  };
  const isIdentifierStart = char => Boolean(char) && /[A-Za-z_$]/.test(char);
  const isIdentifierPart = char => Boolean(char) && /[A-Za-z0-9_$]/.test(char);

  function addPunctuator(value, tokenLine) {
    push('punctuator', value, tokenLine);
    if (value === ')' || value === ']' || value === '}' || value === '.' || value === '?.' || value === '++' || value === '--') {
      canStartRegex = false;
    } else {
      canStartRegex = true;
    }
  }

  function scanString(quote) {
    const start = index;
    const startLine = line;
    index++;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (index + 1 >= source.length) return false;
        skipEscapedChar();
        continue;
      }
      if (char === quote) {
        index++;
        push('string', source.slice(start, index), startLine);
        canStartRegex = false;
        return true;
      }
      if (char === '\n' || char === '\r') return false;
      index++;
    }
    return false;
  }

  function scanRegex() {
    const start = index;
    const startLine = line;
    index++;
    let inCharacterClass = false;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (index + 1 >= source.length || source[index + 1] === '\n' || source[index + 1] === '\r') return false;
        index += 2;
        continue;
      }
      if (char === '[') inCharacterClass = true;
      else if (char === ']') inCharacterClass = false;
      else if (char === '/' && !inCharacterClass) {
        index++;
        while (isIdentifierPart(source[index])) index++;
        push('regex', source.slice(start, index), startLine);
        canStartRegex = false;
        return true;
      }
      if (char === '\n' || char === '\r') return false;
      index++;
    }
    return false;
  }

  function scanTemplate() {
    index++;
    let chunkStart = index;
    let chunkLine = line;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (index + 1 >= source.length) return false;
        skipEscapedChar();
        continue;
      }
      if (char === '`') {
        push('template', source.slice(chunkStart, index), chunkLine);
        index++;
        canStartRegex = false;
        return true;
      }
      if (char === '$' && source[index + 1] === '{') {
        push('template', source.slice(chunkStart, index), chunkLine);
        const markerLine = line;
        index += 2;
        push('template-expression', '${', markerLine);
        canStartRegex = true;
        if (!scanCode(true)) return false;
        chunkStart = index;
        chunkLine = line;
        continue;
      }
      bumpLine(char);
      index++;
    }
    return false;
  }

  function scanCode(stopAtTemplateBrace = false) {
    let braceDepth = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) {
        bumpLine(char);
        index++;
        continue;
      }

      if (char === '/' && source[index + 1] === '/') {
        index += 2;
        while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
        continue;
      }
      if (char === '/' && source[index + 1] === '*') {
        index += 2;
        let closed = false;
        while (index < source.length) {
          if (source[index] === '*' && source[index + 1] === '/') {
            index += 2;
            closed = true;
            break;
          }
          bumpLine(source[index]);
          index++;
        }
        if (!closed) return false;
        continue;
      }
      // Preserve Python-style whole-line comments for the test paths this helper also accepts.
      if (char === '#' && source.slice(0, index).split(/\r?\n/).pop().trim() === '') {
        while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
        continue;
      }

      if (stopAtTemplateBrace && char === '}' && braceDepth === 0) {
        addPunctuator('}', line);
        index++;
        return true;
      }
      if (char === '{') {
        addPunctuator(char, line);
        braceDepth++;
        index++;
        continue;
      }
      if (char === '}' && braceDepth > 0) {
        addPunctuator(char, line);
        braceDepth--;
        index++;
        continue;
      }
      if (char === "'" || char === '"') {
        if (!scanString(char)) return false;
        continue;
      }
      if (char === '`') {
        if (!scanTemplate()) return false;
        continue;
      }
      if (char === '/' && canStartRegex) {
        if (!scanRegex()) return false;
        continue;
      }
      if (isIdentifierStart(char)) {
        const start = index;
        const startLine = line;
        index++;
        while (isIdentifierPart(source[index])) index++;
        const value = source.slice(start, index);
        push('identifier', value, startLine);
        canStartRegex = REGEX_PREFIX_KEYWORDS.has(value);
        continue;
      }
      if (/[0-9]/.test(char)) {
        const start = index;
        const startLine = line;
        index++;
        while (/[A-Za-z0-9_$\.]/.test(source[index] || '')) index++;
        push('number', source.slice(start, index), startLine);
        canStartRegex = false;
        continue;
      }

      const tokenLine = line;
      const operator = MULTI_CHAR_TOKENS.find(value => source.startsWith(value, index));
      const value = operator || char;
      index += value.length;
      addPunctuator(value, tokenLine);
    }
    return !stopAtTemplateBrace;
  }

  valid = scanCode();
  return { tokens, valid };
}

function tokenKey(token) {
  return `${token.type}\u0000${token.value}`;
}

function changedTokens(beforeTokens, afterTokens) {
  let prefix = 0;
  while (prefix < beforeTokens.length && prefix < afterTokens.length
    && tokenKey(beforeTokens[prefix]) === tokenKey(afterTokens[prefix])) prefix++;
  let beforeEnd = beforeTokens.length;
  let afterEnd = afterTokens.length;
  while (beforeEnd > prefix && afterEnd > prefix
    && tokenKey(beforeTokens[beforeEnd - 1]) === tokenKey(afterTokens[afterEnd - 1])) {
    beforeEnd--;
    afterEnd--;
  }
  const removedCount = beforeEnd - prefix;
  const addedCount = afterEnd - prefix;
  const width = addedCount + 1;
  if ((removedCount + 1) * width > MAX_LINE_DIFF_CELLS) return null;

  const table = new Uint32Array((removedCount + 1) * width);
  for (let oldIndex = removedCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = addedCount - 1; newIndex >= 0; newIndex--) {
      const cell = oldIndex * width + newIndex;
      table[cell] = tokenKey(beforeTokens[prefix + oldIndex]) === tokenKey(afterTokens[prefix + newIndex])
        ? table[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(table[(oldIndex + 1) * width + newIndex], table[cell + 1]);
    }
  }

  const removed = [];
  const added = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < removedCount && newIndex < addedCount) {
    if (tokenKey(beforeTokens[prefix + oldIndex]) === tokenKey(afterTokens[prefix + newIndex])) {
      oldIndex++;
      newIndex++;
    } else if (table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1]) {
      removed.push(beforeTokens[prefix + oldIndex++]);
    } else {
      added.push(afterTokens[prefix + newIndex++]);
    }
  }
  while (oldIndex < removedCount) removed.push(beforeTokens[prefix + oldIndex++]);
  while (newIndex < addedCount) added.push(afterTokens[prefix + newIndex++]);
  return { removed, added };
}

function assertionPatternOnLine(tokens, lineNumber) {
  const lineTokens = tokens.filter(token => token.line === lineNumber);
  for (let index = 0; index < lineTokens.length; index++) {
    const token = lineTokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'assert') return true;
    if (token.value === 'expect' && lineTokens[index + 1] && lineTokens[index + 1].value === '(') return true;
    if (['equal', 'deepEqual', 'ok', 'throws'].includes(token.value)
      && lineTokens[index - 1] && ['.', '?.'].includes(lineTokens[index - 1].value)
      && lineTokens[index + 1] && lineTokens[index + 1].value === '(') return true;
  }
  return false;
}

function snapshotText(snapshot, path) {
  const files = snapshot && snapshot.files && typeof snapshot.files === 'object' ? snapshot.files : {};
  const key = Object.keys(files).filter(candidate => normalizePath(candidate) === path).pop();
  if (key === undefined) return { readable: true, text: undefined };
  return typeof files[key] === 'string' ? { readable: true, text: files[key] } : { readable: false, text: undefined };
}

function assertionChangedForTests(changes, baseSnapshot, candidateSnapshot) {
  let changed = false;
  let unknown = false;
  const snapshots = [baseSnapshot, candidateSnapshot];
  for (const snapshot of snapshots) {
    const files = snapshot && snapshot.files && typeof snapshot.files === 'object' ? snapshot.files : {};
    if (Object.keys(files).some(path => TEST_PATH.test(normalizePath(path)) && typeof files[path] !== 'string')) {
      unknown = true;
    }
  }
  for (const change of changes) {
    const oldPath = change.kind === 'rename' ? change.from : change.path;
    const newPath = change.kind === 'rename' ? change.to : change.path;
    if (![oldPath, newPath].some(path => typeof path === 'string' && TEST_PATH.test(path))) continue;
    if (change.kind === 'rename' || !change.contentChanged) continue;
    const before = snapshotText(baseSnapshot, oldPath);
    const after = snapshotText(candidateSnapshot, newPath);
    if (!before.readable || !after.readable) {
      unknown = true;
      continue;
    }
    if (![before.text, after.text].some(text => typeof text === 'string' && REQUIREMENT_ID.test(text))) continue;
    const beforeTokens = tokenizeTestSource(before.text);
    const afterTokens = tokenizeTestSource(after.text);
    if (!beforeTokens.valid || !afterTokens.valid) {
      unknown = true;
      continue;
    }
    const delta = changedTokens(beforeTokens.tokens, afterTokens.tokens);
    if (delta === null) {
      unknown = true;
      continue;
    }
    if (!delta.removed.length && !delta.added.length) continue;
    const changedBeforeLines = new Set(delta.removed.map(token => token.line));
    const changedAfterLines = new Set(delta.added.map(token => token.line));
    const assertionLineChanged = [...changedBeforeLines].some(lineNumber =>
      assertionPatternOnLine(beforeTokens.tokens, lineNumber))
      || [...changedAfterLines].some(lineNumber => assertionPatternOnLine(afterTokens.tokens, lineNumber));
    if (assertionLineChanged) changed = true;
    else if ([...delta.removed, ...delta.added].some(token => ['string', 'template', 'regex'].includes(token.type))) unknown = true;
  }
  return changed ? true : unknown ? 'unknown' : false;
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
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const close = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      fence = { character: open[1][0], length: open[1].length };
      continue;
    }
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
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

function candidateRequirementResolution(id, candidateDocs, baseDeclarations, candidateAnalysis) {
  const diagnostics = candidateAnalysis && Array.isArray(candidateAnalysis.diagnostics)
    ? candidateAnalysis.diagnostics : [];
  const graph = candidateAnalysis && candidateAnalysis._graph;
  const graphCurrentDocs = graph && graph.currentById instanceof Map
    ? new Set(graph.currentById.values()) : new Set();
  const errorPaths = new Set(diagnostics.filter(item => item && item.severity === 'error'
    && typeof item.path === 'string').map(item => normalizePath(item.path)));
  const hasRelevantError = baseDeclarations.some(item => item && item.id === id
    && errorPaths.has(normalizePath(item.file)));
  if (hasRelevantError) return { file: null, resolution: 'analysis-error' };

  const resolved = lifecycle.resolveRef(candidateDocs, id, { graph });
  if (resolved && resolved.doc && resolved.requirement) {
    const requirementId = resolved.requirement.id;
    const duplicateInCurrentDoc = diagnostics.some(item => item && item.severity === 'error'
      && item.code === 'duplicate-req' && item.id === requirementId
      && normalizePath(item.path || '') === normalizePath(resolved.doc.path));
    if (duplicateInCurrentDoc) return { file: null, resolution: 'ambiguous' };

    const effectivePrefix = candidateAnalysis && candidateAnalysis._retirementEligibleSources;
    if (!graphCurrentDocs.has(resolved.doc) || !(effectivePrefix instanceof Set) || !effectivePrefix.has(resolved.doc)) {
      return { file: null, resolution: 'analysis-error' };
    }
    return { file: resolved.doc.path, resolution: 'resolved' };
  }

  const candidates = resolved && Array.isArray(resolved.candidates) ? resolved.candidates : [];
  const currentLogicalIds = new Set(candidates.filter(doc => graphCurrentDocs.has(doc))
    .map(doc => graph.logicalIdByDoc.get(doc)).filter(logicalId => typeof logicalId === 'string'));
  if (currentLogicalIds.size > 1) return { file: null, resolution: 'ambiguous' };
  return { file: null, resolution: 'missing' };
}

function citedRequirementFacts(changes, baseFiles, candidateFiles, candidateDocs, config, candidateAnalysis) {
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
  const result = [];
  for (const id of [...citedIds].sort(compareText)) {
    result.push({ id, ...candidateRequirementResolution(
      id, candidateDocs, before, candidateAnalysis
    ) });
  }
  return result;
}

function derivedEntryAffected(change, item) {
  if (!item || typeof item.path !== 'string') return false;
  const paths = changePaths(change);
  const outputChanged = change.contentChanged && paths.some(path => globToRegExp(item.path).test(path));
  const sources = [item.source, ...(Array.isArray(item.sources) ? item.sources : [])]
    .filter(source => typeof source === 'string');
  const dependencyChanged = (change.contentChanged || change.kind === 'rename')
    && paths.some(path => sources.some(source => globToRegExp(source).test(path)));
  return outputChanged || dependencyChanged;
}

function derivedOutputPaths(changes, config) {
  const entries = Array.isArray(config && config.derived) ? config.derived : [];
  return uniqueSorted(entries.filter(item => item && typeof item.path === 'string'
    && changes.some(change => derivedEntryAffected(change, item))).map(item => item.path));
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

function deriveDocFacts({ base, candidate, config, inventory } = {}) {
  const inputKnown = isSnapshotInput(base) && isSnapshotInput(candidate) && isConfigInput(config);
  const effectiveConfig = isConfigInput(config) ? config : {};
  const inventoryComplete = Boolean(inventory && inventory.complete === true);
  const baseFiles = snapshotFiles(base);
  const candidateFiles = snapshotFiles(candidate);
  const candidateLifecycle = analyzeSnapshotWithLifecycle(candidateFiles, effectiveConfig);
  const candidateAnalysis = candidateLifecycle.summary;
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
      derivedAffected: (effectiveConfig && Array.isArray(effectiveConfig.derived) ? effectiveConfig.derived : [])
        .some(item => derivedEntryAffected({ ...change, contentChanged }, item)),
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
  const assertionChanged = assertionChangedForTests(contextualChanges, base, candidate);
  const newReqCitingTest = contextualChanges.some(change => change.kind === 'added' && change.testWithRequirement);
  const requirementSyncCandidate = newReqCitingTest || assertionChanged === true;
  const codeChanged = contextualChanges.some(change => change.codeChanged);
  const derivedAffected = contextualChanges.some(change => change.derivedAffected);
  const reqUpdates = changedRequirementFacts(baseFiles, candidateFiles, effectiveConfig);
  const citedReqs = citedRequirementFacts(contextualChanges, baseFiles, candidateFiles,
    candidateLifecycle.docs, effectiveConfig, candidateLifecycle.analysis);
  const derivedPaths = derivedOutputPaths(contextualChanges, effectiveConfig);
  const baseAnalysis = analyzeSnapshot(baseFiles, effectiveConfig);
  const inventoryEnvelope = copyInventoryEnvelope(inventory);

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
    assertionChanged,
    inventoryComplete,
    ...(inventoryEnvelope === undefined ? {} : { inventory: inventoryEnvelope }),
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
    else if (facts.assertionChanged === 'unknown' || facts.codeChanged) unknown.add('requirement-sync');
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
  const inventoryEnvelope = validFacts ? copyInventoryEnvelope(facts.inventory) : undefined;
  const requirementFacts = {
    citedReqs: validFacts && Array.isArray(facts.citedReqs) ? facts.citedReqs : [],
    reqUpdates: validFacts && Array.isArray(facts.reqUpdates) ? facts.reqUpdates : [],
    assertionChanged: validFacts && (typeof facts.assertionChanged === 'boolean' || facts.assertionChanged === 'unknown')
      ? facts.assertionChanged : 'unknown',
    inventoryComplete: Boolean(validFacts && facts.inventoryComplete === true),
    ...(inventoryEnvelope === undefined ? {} : { inventory: inventoryEnvelope })
  };
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
