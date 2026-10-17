#!/usr/bin/env node
'use strict';

// Pure project-document lifecycle helpers. This module intentionally does not
// load a host resolver or execute configured derived-document generators.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { isDeepStrictEqual } = require('node:util');

const ROLE_STATUSES = Object.freeze({
  prd: new Set(['draft', 'approved', 'effective', 'rejected', 'withdrawn']),
  adr: new Set(['proposed', 'accepted', 'rejected', 'superseded']),
  ticket: new Set(['open', 'blocked', 'done', 'withdrawn']),
  reference: new Set(['active', 'deprecated']),
  log: new Set(['final', 'archived']),
  report: new Set(['final', 'archived'])
});
const ADR_ID = /^([A-Z][A-Z0-9]{1,9})-(\d{3,})$/;
const REQ_ID = /^REQ-([A-Z][A-Z0-9]{1,9})-(\d{3,})$/;
const ANY_ID = /^(?:REQ-)?[A-Z][A-Z0-9]{1,9}-\d{3,}$/;
const PRD_ID = /^PRD-[A-Z][A-Z0-9]{1,9}-\d{3,}$/;
// One blocker taxonomy serves two projections: retirement eligibility blocks
// on these findings regardless of ratchet severity, while index current-state
// presentation blocks only when the finding is an error.
const AUTHORITY_BLOCKER_DIAGNOSTICS = new Set([
  'invalid-prd-id', 'invalid-revision', 'invalid-status', 'invalid-alias',
  'duplicate-revision', 'missing-parent', 'multiple-baselines', 'revision-cycle',
  'revision-fork', 'revision-digest-mismatch', 'req-dropped', 'incomplete-snapshot',
  'invalid-req-clause', 'duplicate-req', 'replacement-alias-overlap', 'replacement-cycle',
  'approval-missing', 'approval-not-independent', 'approval-content-mismatch',
  'invalid-transition', 'stale-draft-base', 'migration-record-missing', 'migration-record-mismatch',
  'immutable-revision-modified', 'immutable-revision-deleted', 'legacy-frozen-modified', 'duplicate-id', 'alias-collision',
  'unknown-domain', 'invalid-id', 'role-mismatch'
]);
const RETIREMENT_PREFIX_BLOCKERS = AUTHORITY_BLOCKER_DIAGNOSTICS;
const RESOLUTION_DIAGNOSTICS = new Set([
  ...AUTHORITY_BLOCKER_DIAGNOSTICS,
  'malformed-frontmatter', 'missing-id', 'missing-req', 'unresolved-ref',
  'ambiguous-legacy-ref', 'invalid-ref', 'missing-status',
  'supersede-status-mismatch', 'supersede-cycle', 'recorded-conflict',
  'prd-migration-required'
]);

function stripTrailingComment(value) {
  const source = String(value);
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && char === '\\') { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
    else if (char === '#' && depth === 0 && (index === 0 || /[ \t]/.test(source[index - 1]))) {
      return source.slice(0, index).replace(/[ \t]+$/, '');
    }
  }
  return source;
}

function parseScalar(source) {
  const value = stripTrailingComment(source).trim();
  if (!value) return '';
  if (value[0] === '[') {
    if (value[value.length - 1] !== ']') throw new Error('unterminated inline list');
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const items = [];
    let token = '';
    let quote = null;
    let escaped = false;
    for (const char of inner) {
      if (escaped) { token += char; escaped = false; continue; }
      if (quote === '"' && char === '\\') { token += char; escaped = true; continue; }
      if (quote) {
        token += char;
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; token += char; continue; }
      if (char === ',') { items.push(parseScalar(token)); token = ''; continue; }
      token += char;
    }
    if (quote) throw new Error('unterminated quoted list item');
    if (token.trim()) items.push(parseScalar(token));
    else throw new Error('empty inline list item');
    if (items.some(Array.isArray)) throw new Error('nested lists are not supported');
    return items;
  }
  if (value[0] === '{' || value[value.length - 1] === '}') throw new Error('flow mappings are not supported');
  if ((value[0] === '"' && value[value.length - 1] !== '"') || (value[0] === "'" && value[value.length - 1] !== "'")) {
    throw new Error('unterminated quoted scalar');
  }
  if (value[0] === '"') {
    try { return JSON.parse(value); } catch { throw new Error('invalid double-quoted scalar'); }
  }
  if (value[0] === "'") return value.slice(1, -1).replace(/''/g, "'");
  const plain = value.replace(/\s+#.*$/, '').trim();
  if (plain === 'null' || plain === '~') return null;
  if (plain === 'true') return true;
  if (plain === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(plain)) return Number(plain);
  return plain;
}

function parseFrontmatter(text) {
  const source = String(text);
  const firstEnd = source.indexOf('\n');
  const firstLine = (firstEnd < 0 ? source : source.slice(0, firstEnd)).replace(/\r$/, '');
  if (firstLine !== '---') return { data: {}, body: source, error: null };
  if (firstEnd < 0) return { data: {}, body: '', error: 'frontmatter opening delimiter is not closed' };

  const data = {};
  let position = firstEnd + 1;
  let closeEnd = -1;
  let bodyStart = -1;
  const lines = [];
  while (position <= source.length) {
    const newline = source.indexOf('\n', position);
    const end = newline < 0 ? source.length : newline;
    const raw = source.slice(position, end).replace(/\r$/, '');
    if (/^---[ \t]*$/.test(raw) || /^\.\.\.[ \t]*$/.test(raw)) {
      closeEnd = end;
      bodyStart = newline < 0 ? source.length : newline + 1;
      break;
    }
    lines.push(raw);
    if (newline < 0) break;
    position = newline + 1;
  }
  if (closeEnd < 0) return { data: {}, body: source, error: 'frontmatter closing delimiter is missing' };

  try {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (/\t/.test(line)) throw new Error('tabs are not supported in frontmatter');
      const match = line.match(/^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/);
      if (!match) throw new Error(`unsupported frontmatter line: ${line}`);
      const key = match[1];
      if (Object.prototype.hasOwnProperty.call(data, key)) throw new Error(`duplicate key: ${key}`);
      const rest = match[2] || '';
      if (rest.trim()) {
        data[key] = parseScalar(rest);
        continue;
      }

      let cursor = index + 1;
      while (cursor < lines.length && !lines[cursor].trim()) cursor++;
      if (cursor < lines.length && /^[ \t]*-[ \t]/.test(lines[cursor])) {
        const list = [];
        for (; cursor < lines.length; cursor++) {
          const itemLine = lines[cursor];
          if (!itemLine.trim()) continue;
          const item = itemLine.match(/^[ \t]*-[ \t]+(.*)$/);
          if (!item) break;
          if (item[1].trim()) list.push(parseScalar(item[1]));
          else throw new Error(`empty block-list item for ${key}`);
        }
        data[key] = list;
        index = cursor - 1;
      } else if (cursor < lines.length && /^  [A-Za-z0-9_-]+:(?:[ \t].*)?$/.test(lines[cursor])) {
        const mapping = {};
        for (; cursor < lines.length; cursor++) {
          const itemLine = lines[cursor];
          if (!itemLine.trim()) continue;
          const item = itemLine.match(/^  ([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/);
          if (!item) break;
          if (Object.prototype.hasOwnProperty.call(mapping, item[1])) throw new Error(`duplicate nested key: ${item[1]}`);
          mapping[item[1]] = parseScalar(item[2] || '');
        }
        data[key] = mapping;
        index = cursor - 1;
      } else {
        data[key] = '';
      }
    }
    return { data, body: source.slice(bodyStart), error: null };
  } catch (error) {
    return { data: {}, body: source.slice(bodyStart), error: error.message };
  }
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function globToRegExp(glob) {
  const source = String(glob).replace(/\\/g, '/');
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

function matchesAny(relativePath, globs) {
  return (Array.isArray(globs) ? globs : []).some(glob => typeof glob === 'string' && globToRegExp(glob).test(relativePath));
}

function globSegmentToRegExp(segment) {
  return new RegExp(`^${String(segment).split('*').map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*')}$`);
}

function globCanMatchDescendant(relativeDirectory, glob) {
  const normalizedDirectory = String(relativeDirectory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const directorySegments = normalizedDirectory ? normalizedDirectory.split('/') : [];
  const patternSegments = String(glob || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (!patternSegments.length) return false;
  const visited = new Set();
  function visit(patternIndex, directoryIndex) {
    const key = `${patternIndex}:${directoryIndex}`;
    if (visited.has(key)) return false;
    visited.add(key);
    if (directoryIndex === directorySegments.length) return patternIndex < patternSegments.length;
    if (patternIndex >= patternSegments.length) return false;
    const segment = patternSegments[patternIndex];
    if (segment === '**') return visit(patternIndex + 1, directoryIndex) || visit(patternIndex, directoryIndex + 1);
    // A non-component ** can span slashes in globToRegExp. Keep such patterns
    // conservative during pruning instead of risking a false-negative walk.
    if (segment.includes('**')) return true;
    return globSegmentToRegExp(segment).test(directorySegments[directoryIndex])
      && visit(patternIndex + 1, directoryIndex + 1);
  }
  return visit(0, 0);
}

function ignoredTraversalPath(relativePath) {
  return String(relativePath || '').split('/').some(segment => segment === '.git' || segment === 'node_modules');
}

function exactPathCanMatchDescendant(relativeDirectory, paths) {
  const directory = String(relativeDirectory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const prefix = directory ? `${directory}/` : '';
  return [...(paths || [])].some(item => typeof item === 'string' && item !== directory && item.startsWith(prefix));
}

function directoryCanContainMatch(relativeDirectory, globs, exactPaths = []) {
  if (ignoredTraversalPath(relativeDirectory)) return false;
  if ((Array.isArray(exactPaths) ? exactPaths : []).some(item => typeof item === 'string' && item === relativeDirectory)) return false;
  return (Array.isArray(globs) ? globs : []).some(glob => typeof glob === 'string' && globCanMatchDescendant(relativeDirectory, glob))
    || exactPathCanMatchDescendant(relativeDirectory, exactPaths);
}

function collectDocs(root, config) {
  const workspace = path.resolve(root);
  const governed = Array.isArray(config && config.governed) ? config.governed : [];
  const legacyGlobs = Array.isArray(config && config.legacy) ? config.legacy : [];
  const globs = [
    ...governed.map(entry => entry && entry.path),
    ...legacyGlobs
  ].filter(value => typeof value === 'string');
  const files = [];
  function walk(directory, relativeDirectory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (directoryCanContainMatch(relativePath, globs)) walk(absolute, relativePath);
      } else if (entry.isFile() && matchesAny(relativePath, globs)) files.push(absolute);
    }
  }
  walk(workspace, '');

  const selected = [];
  for (const absolute of files) {
    const relativePath = path.relative(workspace, absolute).split(path.sep).join('/');
    const roleEntry = governed.find(entry => entry && typeof entry.path === 'string' && matchesAny(relativePath, [entry.path]));
    const legacy = matchesAny(relativePath, legacyGlobs);
    if (!roleEntry && !legacy) continue;
    let bytes;
    try { bytes = fs.readFileSync(absolute); } catch { continue; }
    selected.push({ relativePath, role: roleEntry ? roleEntry.role : null, legacy, bytes });
  }
  const rules = readWorkingTreeRules(workspace, selected.filter(item => item.bytes.includes(0x0d)).map(item => item.relativePath));
  const docs = [];
  for (const item of selected) {
    const bytes = workingStoredBytes(workspace, item.relativePath, item.bytes, rules);
    const parsed = parseFrontmatter(bytes.toString('utf8'));
    const doc = {
      path: item.relativePath,
      role: item.role,
      legacy: item.legacy,
      frontmatter: parsed.data,
      body: parsed.body,
      error: parsed.error
    };
    Object.defineProperties(doc, {
      workspace: { value: workspace, enumerable: false, writable: true },
      storedBytes: { value: bytes, enumerable: false, writable: true }
    });
    docs.push(doc);
  }
  docs.sort((a, b) => compareText(a.path, b.path));
  return docs;
}

function idFromLegacy(doc) {
  const frontmatter = doc.frontmatter || {};
  if (typeof frontmatter.id === 'string' && frontmatter.id) return frontmatter.id;
  const stem = path.posix.basename(doc.path, path.posix.extname(doc.path));
  return ANY_ID.test(stem) ? stem : null;
}

function validLegacySelectorPath(value) {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split('/');
  return !segments.some(segment => segment === '.' || segment === '..');
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== 'Z' && Number(zone.slice(1, 3)) > 23) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function docBytes(doc) {
  if (doc && Buffer.isBuffer(doc.storedBytes)) return doc.storedBytes;
  if (doc && doc.storedBytes instanceof Uint8Array) return Buffer.from(doc.storedBytes);
  return Buffer.from(String(doc && doc.body || ''), 'utf8');
}

function artifactDigest(doc) {
  return sha256(docBytes(doc));
}

function approvalDigest(doc) {
  const data = { ...(doc.frontmatter || {}) };
  delete data.status;
  delete data.effective_at;
  delete data.approval;
  const bodyBytes = Buffer.from(String(doc.body || ''), 'utf8');
  return sha256(Buffer.concat([Buffer.from(`${sortedJson(data)}\n`, 'utf8'), bodyBytes]));
}

function isPrdCompatibility(doc) {
  if (!doc || doc.legacy || doc.role !== 'prd' || !doc.frontmatter) return false;
  const data = doc.frontmatter;
  return !Object.prototype.hasOwnProperty.call(data, 'revision')
    && !Object.prototype.hasOwnProperty.call(data, 'previous_revision')
    && ['active', 'superseded'].includes(data.status);
}

function isRevisionPrd(doc) {
  return Boolean(doc && !doc.legacy && doc.role === 'prd' && doc.frontmatter && !isPrdCompatibility(doc));
}

function eligibleRetirementSource(source, validatedEffectivePrefix) {
  return validatedEffectivePrefix instanceof Set && validatedEffectivePrefix.has(source);
}

function supersessionEligibility(source, target, ref, validatedEffectivePrefix, graph = null) {
  const sameLogicalPrd = graph && isRevisionPrd(source) && isRevisionPrd(target)
    && graph.logicalIdByDoc.get(source) === graph.logicalIdByDoc.get(target);
  const retirement = isRevisionPrd(source) && isRevisionPrd(target)
    && !sameLogicalPrd
    && /@r[1-9]\d*$/.test(ref);
  const effective = retirement
    ? eligibleRetirementSource(source, validatedEffectivePrefix)
    : (source.role === 'adr' && source.frontmatter.status === 'accepted')
      || (source.role === 'prd' && isRevisionPrd(source) && eligibleRetirementSource(source, validatedEffectivePrefix));
  return { retirement, effective };
}

function validatedEffectivePrefix(docs, graph, config = null, validationDiagnostics = [], { includeGraphDiagnostics = true } = {}) {
  const entries = Array.isArray(docs) ? docs : [];
  const diagnostics = [...(includeGraphDiagnostics && graph && Array.isArray(graph.diagnostics) ? graph.diagnostics : []),
    ...(Array.isArray(validationDiagnostics) ? validationDiagnostics : [])];
  const blockedPaths = new Set(diagnostics
    .filter(item => item && typeof item.path === 'string'
      && RETIREMENT_PREFIX_BLOCKERS.has(item.code))
    .map(item => item.path));
  const domains = new Set(Array.isArray(config && config.domains) ? config.domains : []);
  const validEffectiveRevision = doc => {
    if (!isRevisionPrd(doc) || doc.error || blockedPaths.has(doc.path)) return false;
    const data = doc.frontmatter || {};
    const idMatch = typeof data.id === 'string' ? data.id.match(/^PRD-([A-Z][A-Z0-9]{1,9})-\d{3,}$/) : null;
    if (!idMatch || !Number.isInteger(data.revision) || data.revision <= 0 || data.status !== 'effective') return false;
    if (!domains.has(idMatch[1])) return false;
    if (data.role !== undefined && data.role !== 'prd') return false;
    if (typeof data.drafted_by !== 'string' || !data.drafted_by.trim()) return false;
    const approval = data.approval;
    if (!approval || typeof approval !== 'object'
      || ['by', 'at', 'ref', 'content_digest', 'role'].some(key => typeof approval[key] !== 'string' || !approval[key].trim())
      || !['human', 'cold-verifier'].includes(approval.role)
      || approval.by === data.drafted_by
      || approval.content_digest !== approvalDigest(doc)) return false;
    const approvalTime = isoTimestamp(approval.at);
    const effectiveTime = isoTimestamp(data.effective_at);
    if (approvalTime === null || effectiveTime === null || effectiveTime < approvalTime) return false;
    return true;
  };

  const eligible = new Set();
  for (const [logicalId, group] of (graph && graph.groups || new Map())) {
    const logicalNames = graph.namesByLogicalId.get(logicalId) || new Set();
    if ([...logicalNames].some(name => (graph.logicalIdsByName.get(name) || new Set()).size !== 1)) continue;
    const baselines = group.filter(doc => doc.frontmatter.previous_revision === undefined
      || doc.frontmatter.previous_revision === null || doc.frontmatter.previous_revision === '');
    if (baselines.length !== 1) continue;
    const baseline = baselines[0];
    if (!validEffectiveRevision(baseline)) continue;
    const byRevision = new Map();
    for (const doc of group) {
      const revision = doc.frontmatter.revision;
      if (!byRevision.has(revision)) byRevision.set(revision, []);
      byRevision.get(revision).push(doc);
    }
    eligible.add(baseline);
    let cursor = baseline;
    const visited = new Set([baseline]);
    while (cursor) {
      const children = group.filter(doc => doc.frontmatter.status === 'effective'
        && doc.frontmatter.previous_revision === cursor.frontmatter.revision);
      if (!children.length || children.length !== 1) break;
      const child = children[0];
      if (visited.has(child)
        || (byRevision.get(child.frontmatter.revision) || []).length !== 1
        || graph.logicalIdByDoc.get(child) !== logicalId
        || child.frontmatter.revision <= cursor.frontmatter.revision
        || child.frontmatter.previous_digest !== artifactDigest(cursor)
        || !validEffectiveRevision(child)) break;
      eligible.add(child);
      visited.add(child);
      cursor = child;
    }
  }
  return eligible;
}

function parseRequirementBlocks(doc) {
  const lines = withoutFencedCode(doc.body || '').split(/\r?\n/);
  const headings = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^#{1,6}[ \t]+(REQ-[A-Z][A-Z0-9]{1,9}-\d{3,})(.*)$/);
    if (match) headings.push({ index, id: match[1], tail: match[2] });
  }
  return headings.map((heading, position) => {
    const end = position + 1 < headings.length ? headings[position + 1].index : lines.length;
    const block = lines.slice(heading.index + 1, end).join('\n');
    const item = { id: heading.id, aliases: [], replaces: [], doc, title: '', block, validClause: true };
    let tail = heading.tail;
    if (/^[ \t]*\(/.test(tail)) {
      const open = tail.indexOf('(');
      const close = tail.indexOf(')', open + 1);
      if (close < 0) item.validClause = false;
      else {
        const clauseText = tail.slice(open + 1, close);
        tail = tail.slice(close + 1);
        const seen = new Set();
        for (const clause of clauseText.split(';')) {
          const match = clause.trim().match(/^([a-z][a-z_-]*):[ \t]*(.*)$/);
          if (!match || !['replaces', 'aliases'].includes(match[1]) || seen.has(match[1]) || !match[2].trim()) {
            item.validClause = false;
            continue;
          }
          seen.add(match[1]);
          const values = match[2].split(',').map(value => value.trim());
          if (values.some(value => !REQ_ID.test(value))) item.validClause = false;
          if (match[1] === 'replaces') item.replaces = values;
          else item.aliases = values;
        }
      }
    }
    item.title = tail.replace(/^[: \t]+/, '').trim();
    const acceptance = block.match(/(?:^|\n)[ \t]*Acceptance:[ \t]*([^\n]*(?:\n(?!#{1,6}[ \t]+)[^\n]*)*)/i);
    item.acceptance = acceptance ? acceptance[1].trim() : '';
    return item;
  });
}

function allRevisionRequirements(docs) {
  return (docs || []).filter(isRevisionPrd).flatMap(parseRequirementBlocks);
}

function revisionGraph(docs) {
  const entries = (Array.isArray(docs) ? docs : []).filter(isRevisionPrd).slice().sort((a, b) => compareText(a.path, b.path));
  const groups = new Map();
  const diagnostics = [];
  const artifactDigests = new Map();
  const digestFor = doc => {
    if (!artifactDigests.has(doc)) artifactDigests.set(doc, artifactDigest(doc));
    return artifactDigests.get(doc);
  };
  const add = (code, doc, message, id, candidates) => diagnostics.push(makeDiagnostic(code, 'error', doc, message, id, candidates));
  const validEntries = [];
  for (const doc of entries) {
    const data = doc.frontmatter || {};
    if (typeof data.id !== 'string' || !PRD_ID.test(data.id)) add('invalid-prd-id', doc, 'PRD id must match PRD-<DOMAIN>-NNN', data.id);
    if (!Number.isInteger(data.revision) || data.revision <= 0) {
      add('invalid-revision', doc, 'revision must be a positive integer without leading zeros', data.id);
    }
    if (!['draft', 'approved', 'effective', 'rejected', 'withdrawn'].includes(data.status)) add('invalid-status', doc, `status ${String(data.status)} is not valid for revisioned PRDs`, data.id);
    if (data.aliases !== undefined && data.aliases !== '' && !Array.isArray(data.aliases)) {
      add('invalid-alias', doc, 'document aliases must be a list', data.id);
    }
    for (const alias of Array.isArray(data.aliases) ? data.aliases : []) {
      if (typeof alias !== 'string' || !PRD_ID.test(alias) || alias === data.id) {
        add('invalid-alias', doc, `invalid PRD alias ${String(alias)}`, typeof alias === 'string' ? alias : data.id);
      }
    }
    if (typeof data.id === 'string' && PRD_ID.test(data.id) && Number.isInteger(data.revision) && data.revision > 0) validEntries.push(doc);
  }

  // A PRD can change its canonical spelling between revisions. Union only
  // identities linked by an adjacent previous_revision edge; a free-standing
  // alias that collides with another logical PRD remains ambiguous and is
  // reported by the active namespace checks below.
  const identityParent = new Map(validEntries.map(doc => [doc, doc]));
  const findIdentity = doc => {
    const parent = identityParent.get(doc);
    if (parent !== doc) identityParent.set(doc, findIdentity(parent));
    return identityParent.get(doc);
  };
  const joinIdentity = (left, right) => {
    const a = findIdentity(left);
    const b = findIdentity(right);
    if (a !== b) identityParent.set(b, a);
  };
  const docsByCanonicalId = new Map();
  for (const doc of validEntries) {
    const id = doc.frontmatter.id;
    if (!docsByCanonicalId.has(id)) docsByCanonicalId.set(id, []);
    docsByCanonicalId.get(id).push(doc);
  }
  for (const sameId of docsByCanonicalId.values()) for (let index = 1; index < sameId.length; index++) joinIdentity(sameId[0], sameId[index]);
  for (const doc of validEntries) {
    const data = doc.frontmatter;
    if (!Number.isInteger(data.previous_revision)) continue;
    for (const alias of Array.isArray(data.aliases) ? data.aliases : []) {
      for (const candidate of docsByCanonicalId.get(alias) || []) {
        if (candidate.frontmatter.revision === data.previous_revision) joinIdentity(doc, candidate);
      }
    }
  }
  const components = new Map();
  for (const doc of validEntries) {
    const root = findIdentity(doc);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(doc);
  }
  const logicalIdByDoc = new Map();
  for (const component of components.values()) {
    component.sort((a, b) => a.frontmatter.revision - b.frontmatter.revision || compareText(a.path, b.path));
    const baselines = component.filter(doc => doc.frontmatter.previous_revision === undefined || doc.frontmatter.previous_revision === null || doc.frontmatter.previous_revision === '');
    const logicalId = (baselines[0] || component[0]).frontmatter.id;
    groups.set(logicalId, component);
    for (const doc of component) logicalIdByDoc.set(doc, logicalId);
  }

  const currentById = new Map();
  const structurallyValid = new Map();
  const parentByDoc = new Map();
  for (const [id, group] of groups) {
    group.sort((a, b) => a.frontmatter.revision - b.frontmatter.revision || compareText(a.path, b.path));
    const byRevision = new Map();
    for (const doc of group) {
      const revision = doc.frontmatter.revision;
      if (!byRevision.has(revision)) byRevision.set(revision, []);
      byRevision.get(revision).push(doc);
    }
    let valid = true;
    for (const [revision, members] of byRevision) if (members.length > 1) {
      valid = false;
      const paths = members.map(item => item.path).sort(compareText);
      for (const doc of members) add('duplicate-revision', doc, `${id}@r${revision} is declared more than once`, id, paths.filter(item => item !== doc.path));
    }
    const baselines = group.filter(doc => doc.frontmatter.previous_revision === undefined || doc.frontmatter.previous_revision === null || doc.frontmatter.previous_revision === '');
    if (baselines.length !== 1) {
      valid = false;
      const involved = baselines.length ? baselines : group;
      for (const doc of involved) add('multiple-baselines', doc, `${id} must have exactly one baseline revision`, id, involved.filter(item => item.path !== doc.path).map(item => item.path).sort(compareText));
    }
    const parentEdges = new Map();
    const effectiveChildren = new Map();
    for (const doc of group) {
      const data = doc.frontmatter;
      if (data.previous_revision === undefined || data.previous_revision === null || data.previous_revision === '') continue;
      const parentRevision = data.previous_revision;
      const parent = Number.isInteger(parentRevision) ? byRevision.get(parentRevision) : null;
      if (!parent || parent.length !== 1) {
        valid = false;
        add('missing-parent', doc, `parent revision ${String(parentRevision)} of ${id} does not exist uniquely`, id);
        continue;
      }
      if (parentRevision >= data.revision) {
        valid = false;
        add('missing-parent', doc, 'parent revision must be smaller than its child', id, [parent[0].path]);
      }
      parentEdges.set(doc, parent[0]);
      parentByDoc.set(doc, parent[0]);
      if (data.previous_digest !== digestFor(parent[0])) {
        add('revision-digest-mismatch', doc, `previous_digest does not match ${id}@r${parentRevision}`, id, [parent[0].path]);
      }
      if (data.status === 'effective') {
        if (!effectiveChildren.has(parent[0])) effectiveChildren.set(parent[0], []);
        effectiveChildren.get(parent[0]).push(doc);
      }
    }
    const visiting = new Set();
    const visited = new Set();
    let cycleFound = false;
    const visit = doc => {
      if (visiting.has(doc)) { cycleFound = true; return; }
      if (visited.has(doc)) return;
      visiting.add(doc);
      const parent = parentEdges.get(doc);
      if (parent) visit(parent);
      visiting.delete(doc);
      visited.add(doc);
    };
    for (const doc of group) visit(doc);
    if (cycleFound) {
      valid = false;
      for (const doc of group) add('revision-cycle', doc, `${id} contains a revision parent cycle`, id);
    }
    for (const [parent, children] of effectiveChildren) if (children.length > 1) {
      valid = false;
      const involved = [parent, ...children].sort((a, b) => compareText(a.path, b.path));
      for (const doc of children) add('revision-fork', doc, `effective revisions fork from ${parent.path}`, id, involved.filter(item => item.path !== doc.path).map(item => item.path));
    }
    const baseline = baselines.length === 1 ? baselines[0] : null;
    let current = null;
    if (valid && baseline) {
      if (baseline.frontmatter.status === 'effective') current = baseline;
      const effectiveSet = new Set(group.filter(doc => doc.frontmatter.status === 'effective'));
      let cursor = baseline;
      const reached = new Set();
      if (current) reached.add(cursor);
      while (current) {
        const children = (effectiveChildren.get(cursor) || []).filter(child => effectiveSet.has(child));
        if (children.length > 1) { current = null; valid = false; break; }
        if (!children.length) break;
        cursor = children[0];
        reached.add(cursor);
        current = cursor;
      }
      if ([...effectiveSet].some(doc => !reached.has(doc))) {
        valid = false;
        current = null;
        const disconnected = [...effectiveSet].filter(doc => !reached.has(doc));
        for (const doc of disconnected) add('revision-fork', doc, 'effective revision is disconnected from the baseline effective chain', id);
      }
    }
    structurallyValid.set(id, valid);
    if (valid && current) currentById.set(id, current);

    const reqsByDoc = new Map(group.map(doc => [doc, parseRequirementBlocks(doc)]));
    const replacementTargetsByDoc = new Map();
    const lineageFor = doc => {
      const lineage = [];
      const seen = new Set();
      let cursor = doc;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        lineage.unshift(cursor);
        cursor = parentEdges.get(cursor);
      }
      return lineage;
    };
    for (const [doc, reqs] of reqsByDoc) {
      const seen = new Set();
      for (const req of reqs) {
        if (!REQ_ID.test(req.id)) add('invalid-req-clause', doc, `invalid requirement ID ${req.id}`, req.id);
        if (seen.has(req.id)) add('duplicate-req', doc, `requirement ${req.id} is repeated in this revision`, req.id);
        seen.add(req.id);
        if (!req.validClause) add('invalid-req-clause', doc, `requirement ${req.id} has an invalid clause`, req.id);
        if (!req.acceptance) add('incomplete-snapshot', doc, `requirement ${req.id} has no non-empty Acceptance content`, req.id);
        if (req.replaces.some(oldId => req.aliases.includes(oldId))) add('replacement-alias-overlap', doc, `requirement ${req.id} aliases an ID that it replaces`, req.id);
      }

      const ancestors = lineageFor(doc).slice(0, -1);
      const historicalNames = new Map();
      for (const ancestor of ancestors) for (const priorReq of reqsByDoc.get(ancestor) || []) {
        for (const name of [priorReq.id, ...priorReq.aliases]) {
          if (!historicalNames.has(name)) historicalNames.set(name, new Set());
          historicalNames.get(name).add(priorReq.id);
        }
      }
      const targetsByRequirement = new Map();
      for (const req of reqs) {
        const targets = [];
        for (const name of req.replaces) {
          const candidates = historicalNames.get(name);
          if (!candidates || !candidates.size) {
            add('invalid-req-clause', doc, `replacement target ${name} is absent from predecessor history`, name);
          } else if (candidates.size > 1) {
            add('invalid-req-clause', doc, `replacement target ${name} is ambiguous in predecessor history`, name, [...candidates].sort(compareText));
          } else {
            targets.push([...candidates][0]);
          }
        }
        const overlapsReplacement = targets.some(target => req.aliases.some(alias => alias === target || (historicalNames.get(alias) || new Set()).has(target)));
        if (overlapsReplacement && !req.replaces.some(name => req.aliases.includes(name))) {
          add('replacement-alias-overlap', doc, `requirement ${req.id} aliases an ID that it replaces`, req.id);
        }
        targetsByRequirement.set(req, targets);
      }
      replacementTargetsByDoc.set(doc, targetsByRequirement);
    }

    // A removed or replaced identity is a tombstone along each parent chain.
    // Reusing it with different title/acceptance content would recycle meaning.
    for (const doc of group) {
      const lineage = lineageFor(doc);
      const tombstones = new Map();
      for (let index = 0; index < lineage.length; index++) {
        const currentDoc = lineage[index];
        const currentReqs = reqsByDoc.get(currentDoc) || [];
        const currentById = new Map(currentReqs.map(req => [req.id, req]));
        const previousDoc = index > 0 ? lineage[index - 1] : null;
        const previousReqs = previousDoc ? reqsByDoc.get(previousDoc) || [] : [];
        const previousIds = new Set(previousReqs.map(req => req.id));
        for (const req of currentReqs) {
          const retired = tombstones.get(req.id);
          if (retired && !previousIds.has(req.id)
            && (req.title !== retired.title || req.acceptance !== retired.acceptance)) {
            add('invalid-req-clause', currentDoc, `tombstoned requirement ${req.id} cannot be reused with a new meaning`, req.id, [retired.doc.path]);
          }
        }
        if (!previousDoc) continue;
        const removed = new Set(asList(currentDoc.frontmatter.removed_reqs));
        const replaced = new Set([...(replacementTargetsByDoc.get(currentDoc) || new Map()).values()].flat());
        for (const priorReq of previousReqs) {
          if (!currentById.has(priorReq.id) && (removed.has(priorReq.id) || replaced.has(priorReq.id)) && !tombstones.has(priorReq.id)) {
            tombstones.set(priorReq.id, { ...priorReq, doc: previousDoc });
          }
        }
      }
    }

    for (const doc of group) {
      const data = doc.frontmatter;
      const parent = parentEdges.get(doc);
      if (parent) {
        const parentReqs = reqsByDoc.get(parent) || [];
        const childReqs = reqsByDoc.get(doc) || [];
        const childIds = new Set(childReqs.map(req => req.id));
        const replaced = new Set([...(replacementTargetsByDoc.get(doc) || new Map()).values()].flat());
        const removed = new Set(asList(data.removed_reqs));
        for (const req of parentReqs) if (!childIds.has(req.id) && !replaced.has(req.id) && !removed.has(req.id)) {
          add('req-dropped', doc, `parent requirement ${req.id} is missing without removed_reqs or a replaces edge`, req.id, [parent.path]);
        }
      }
      if (['approved', 'effective'].includes(data.status)) {
        if (typeof data.drafted_by !== 'string' || !data.drafted_by.trim()) {
          add('approval-missing', doc, 'approved/effective revisions must include non-empty drafted_by', id);
        }
        const approval = data.approval;
        const required = ['by', 'at', 'ref', 'content_digest', 'role'];
        if (!approval || typeof approval !== 'object' || required.some(key => typeof approval[key] !== 'string' || !approval[key].trim())) {
          add('approval-missing', doc, `approval must include ${required.join(', ')}`, id);
        } else {
          if (!['human', 'cold-verifier'].includes(approval.role)) add('approval-missing', doc, 'approval.role must be human or cold-verifier', id);
          if (approval.by === data.drafted_by) add('approval-not-independent', doc, 'approval.by must differ from drafted_by', id);
          if (approval.content_digest !== approvalDigest(doc)) add('approval-content-mismatch', doc, 'approval digest does not match the body and non-activation frontmatter', id);
          if (isoTimestamp(approval.at) === null) add('invalid-transition', doc, 'approval.at must be an ISO 8601 timestamp with timezone', id);
          if (!/^https?:\/\//i.test(approval.ref)) {
            const workspace = doc.workspace;
            const target = typeof workspace === 'string' && validLegacySelectorPath(approval.ref) ? path.join(workspace, ...approval.ref.split('/')) : null;
            if (!target || !fs.existsSync(target)) add('approval-missing', doc, `approval evidence ref ${approval.ref} cannot be resolved`, id);
          }
        }
        if (data.status === 'effective' && (typeof data.effective_at !== 'string' || !data.effective_at.trim())) {
          add('invalid-transition', doc, 'effective revisions must record effective_at', id);
        }
        if (data.status === 'effective' && typeof data.effective_at === 'string' && data.effective_at.trim()) {
          const approvalTime = approval && isoTimestamp(approval.at);
          const effectiveTime = isoTimestamp(data.effective_at);
          if (effectiveTime === null) add('invalid-transition', doc, 'effective_at must be an ISO 8601 timestamp with timezone', id);
          else if (approvalTime !== null && effectiveTime < approvalTime) add('invalid-transition', doc, 'effective_at must not precede approval.at', id);
        }
      }
    }

    const replacementEdges = group.flatMap(doc => (reqsByDoc.get(doc) || []).flatMap(req => (replacementTargetsByDoc.get(doc).get(req) || []).map(from => ({ from, to: req.id, doc }))));
    const adjacency = new Map();
    for (const edge of replacementEdges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push(edge.to);
    }
    const reqVisiting = new Set();
    const reqVisited = new Set();
    let replacementCycle = false;
    const reqVisit = idValue => {
      if (reqVisiting.has(idValue)) { replacementCycle = true; return; }
      if (reqVisited.has(idValue)) return;
      reqVisiting.add(idValue);
      for (const next of adjacency.get(idValue) || []) reqVisit(next);
      reqVisiting.delete(idValue);
      reqVisited.add(idValue);
    };
    for (const reqId of adjacency.keys()) reqVisit(reqId);
    if (replacementCycle) for (const doc of group) add('replacement-cycle', doc, `${id} contains a REQ replacement cycle`, id);
    const authoritativePaths = new Set(group.filter(doc => doc.frontmatter.status === 'effective').map(doc => doc.path));
    const currentValidationCodes = new Set([
      'invalid-prd-id', 'invalid-revision', 'invalid-status', 'duplicate-revision',
      'invalid-alias',
      'missing-parent', 'multiple-baselines', 'revision-cycle', 'revision-fork',
      'revision-digest-mismatch', 'req-dropped', 'incomplete-snapshot',
      'invalid-req-clause', 'replacement-alias-overlap', 'replacement-cycle',
      'approval-missing', 'approval-not-independent', 'approval-content-mismatch', 'invalid-transition'
    ]);
    if (diagnostics.some(item => authoritativePaths.has(item.path) && currentValidationCodes.has(item.code))) {
      structurallyValid.set(id, false);
      currentById.delete(id);
    }
  }

  const namesByLogicalId = new Map();
  const logicalIdsByName = new Map();
  for (const [logicalId, group] of groups) {
    const names = new Set();
    for (const doc of group) {
      names.add(doc.frontmatter.id);
      for (const alias of Array.isArray(doc.frontmatter.aliases) ? doc.frontmatter.aliases : []) if (typeof alias === 'string' && PRD_ID.test(alias)) names.add(alias);
    }
    namesByLogicalId.set(logicalId, names);
    for (const name of names) {
      if (!logicalIdsByName.has(name)) logicalIdsByName.set(name, new Set());
      logicalIdsByName.get(name).add(logicalId);
    }
  }
  const namesAtRevision = new Map();
  for (const group of groups.values()) for (const doc of group) {
    const names = new Set();
    const seen = new Set();
    let cursor = doc;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      names.add(cursor.frontmatter.id);
      for (const alias of Array.isArray(cursor.frontmatter.aliases) ? cursor.frontmatter.aliases : []) if (typeof alias === 'string' && PRD_ID.test(alias)) names.add(alias);
      cursor = parentByDoc.get(cursor);
    }
    namesAtRevision.set(doc, names);
  }
  return { groups, currentById, structurallyValid, logicalIdByDoc, logicalIdsByName, namesByLogicalId, namesAtRevision, parentByDoc, artifactDigests, diagnostics: sortDiagnostics(diagnostics) };
}

function reqDeclarations(docs, graph = null) {
  const entries = Array.isArray(docs) ? docs : [];
  const revisionState = graph || revisionGraph(entries);
  const declarations = [];
  for (const doc of revisionState.currentById.values()) declarations.push(...parseRequirementBlocks(doc));
  return declarations;
}

function activeDeclarations(docs, graph = null) {
  const result = [];
  const revisionState = graph || revisionGraph(docs);
  const currentDocs = new Set(revisionState.currentById.values());
  for (const doc of docs || []) {
    if (doc.legacy || !doc.frontmatter
      || (doc.role === 'prd' && (!isRevisionPrd(doc) || !currentDocs.has(doc)))) continue;
    const id = doc.frontmatter.id;
    if (typeof id === 'string' && id) result.push({ id, aliases: Array.isArray(doc.frontmatter.aliases) ? doc.frontmatter.aliases : [], doc, kind: 'document' });
  }
  for (const req of reqDeclarations(docs || [], revisionState)) result.push({ ...req, kind: 'requirement' });
  return result;
}

function revisionResult(doc, requirement, digest = null) {
  const result = {
    doc,
    revision: doc.frontmatter.revision,
    status: doc.frontmatter.status,
    digest: digest || artifactDigest(doc),
    provenance: { id: doc.frontmatter.id, revision: doc.frontmatter.revision, path: doc.path, parent: doc.frontmatter.previous_revision }
  };
  if (requirement) result.requirement = { id: requirement.id };
  return result;
}

function resolveRef(docs, ref, context = {}) {
  if (typeof ref !== 'string' || !ref.trim()) return { error: 'unresolved-ref', candidates: [] };
  const value = ref.trim();
  const allDocs = Array.isArray(docs) ? docs : [];
  const graph = context.graph || revisionGraph(allDocs);
  if (value.startsWith('legacy:')) {
    const selector = value.slice('legacy:'.length);
    const at = selector.indexOf('@');
    const id = at < 0 ? selector : selector.slice(0, at);
    const archivePath = at < 0 ? null : selector.slice(at + 1);
    if (!ANY_ID.test(id) || (archivePath !== null && !validLegacySelectorPath(archivePath))) return { error: 'invalid-ref', candidates: [] };
    let candidates = allDocs.filter(doc => doc.legacy && idFromLegacy(doc) === id);
    if (archivePath !== null) candidates = candidates.filter(doc => doc.path === archivePath);
    candidates.sort((a, b) => compareText(a.path, b.path));
    if (candidates.length === 1) return { doc: candidates[0] };
    if (candidates.length > 1) return { error: 'ambiguous-legacy-ref', candidates };
    return { error: 'unresolved-ref', candidates: [] };
  }

  const prdMatch = value.match(/^(PRD-[A-Z][A-Z0-9]{1,9}-\d{3,})(?:@r([1-9]\d*))?(?:#(REQ-[A-Z][A-Z0-9]{1,9}-\d{3,}))?$/);
  if (value.startsWith('PRD-') || value.includes('@r') || value.includes('#')) {
    if (!prdMatch || !PRD_ID.test(prdMatch[1])) return { error: 'invalid-ref', candidates: [] };
    const logicalIds = graph.logicalIdsByName.get(prdMatch[1]) || new Set();
    if (logicalIds.size > 1) {
      const candidates = [...logicalIds].flatMap(id => graph.groups.get(id) || []).sort((a, b) => compareText(a.path, b.path));
      return { doc: null, error: 'unresolved-ref', candidates, message: `PRD identity ${prdMatch[1]} is ambiguous across logical PRDs` };
    }
    const logicalId = [...logicalIds][0];
    const group = logicalId ? graph.groups.get(logicalId) || [] : [];
    if (prdMatch[2] || prdMatch[3] || group.length) {
      let target;
      if (prdMatch[2]) {
        const exact = group.filter(doc => doc.frontmatter.revision === Number(prdMatch[2]));
        if (exact.length > 1) return { doc: null, error: 'unresolved-ref', candidates: exact.sort((a, b) => compareText(a.path, b.path)) };
        target = exact[0];
      }
      else target = logicalId ? graph.currentById.get(logicalId) : undefined;
      if (!target) return { doc: null, error: 'unresolved-ref', candidates: group.slice().sort((a, b) => compareText(a.path, b.path)) };
      if (!graph.namesAtRevision.get(target)?.has(prdMatch[1])) {
        return { doc: null, error: 'unresolved-ref', candidates: [target], message: `PRD identity ${prdMatch[1]} was not declared by ${target.frontmatter.id}@r${target.frontmatter.revision}` };
      }
      const digest = graph.artifactDigests.get(target);
      if (!prdMatch[3]) return revisionResult(target, null, digest);
      const requested = prdMatch[3];
      const requirement = parseRequirementBlocks(target).find(item => item.id === requested || item.aliases.includes(requested));
      return requirement ? revisionResult(target, requirement, digest) : { error: 'unresolved-ref', candidates: [target], message: `requirement ${requested} is not declared by ${prdMatch[1]}@r${target.frontmatter.revision}` };
    }
  }

  const matches = [];
  for (const declaration of activeDeclarations(allDocs, graph)) if (declaration.id === value || declaration.aliases.includes(value)) matches.push(declaration);
  const uniqueMatches = [...new Map(matches.map(item => [`${item.doc.path}\0${item.id}`, item])).values()]
    .sort((a, b) => compareText(a.doc.path, b.doc.path));
  if (uniqueMatches.length === 1) {
    const match = uniqueMatches[0];
    if (match.kind === 'requirement') return { doc: match.doc, requirement: { id: match.id } };
    return { doc: match.doc };
  }
  if (uniqueMatches.length > 1) return { error: 'unresolved-ref', candidates: [...new Map(uniqueMatches.map(item => [item.doc.path, item.doc])).values()] };
  const legacyMatches = allDocs.filter(doc => doc.legacy && idFromLegacy(doc) === value).sort((a, b) => compareText(a.path, b.path));
  if (!legacyMatches.length && /^REQ-/.test(value)) {
    const historical = allRevisionRequirements(allDocs).filter(item => item.id === value || item.aliases.includes(value));
    const replacement = allRevisionRequirements(allDocs).flatMap(item => item.replaces.includes(value) ? [{ item }] : []);
    if (historical.length || replacement.length) return { error: 'unresolved-ref', candidates: historical.map(item => item.doc), message: replacement.length ? `historical requirement ${value} was replaced by ${replacement.map(item => item.item.id).sort(compareText).join(', ')}` : `requirement ${value} is historical and not current` };
  }
  return { error: 'unresolved-ref', candidates: legacyMatches, ...(legacyMatches.length ? { message: `legacy-only ID; use legacy:${value}` } : {}) };
}

function withoutFencedCode(body) {
  let fenced = null;
  return String(body).split(/\r?\n/).filter(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (marker) {
      const token = marker[1];
      const rest = marker[2];
      if (!fenced) fenced = { char: token[0], length: token.length };
      else if (token[0] === fenced.char && token.length >= fenced.length && /^\s*$/.test(rest)) fenced = null;
      return false;
    }
    return !fenced;
  }).join('\n');
}

function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function makeDiagnostic(code, severity, doc, message, id, candidates) {
  const diagnostic = { code, severity, path: doc && doc.path ? doc.path : '', message };
  if (id !== undefined && id !== null) diagnostic.id = id;
  if (candidates && candidates.length) diagnostic.candidates = candidates;
  return diagnostic;
}

function sortDiagnostics(diagnostics) {
  return diagnostics.sort((a, b) => compareText(a.path, b.path)
    || compareText(a.code, b.code)
    || compareText(a.id || '', b.id || '')
    || compareText(a.message, b.message));
}

function lintDocs(docs, config, options = {}) {
  const entries = Array.isArray(docs) ? docs : [];
  const governed = entries.filter(doc => !doc.legacy);
  const changedSet = new Set((Array.isArray(options.changedPaths) ? options.changedPaths : []).map(String));
  const full = options.all === true;
  const diagnostics = [];
  const changed = doc => full || changedSet.has(doc.path);
  const crossSeverity = involved => full || involved.some(doc => doc && changedSet.has(doc.path)) ? 'error' : 'warning';
  const domains = new Set(Array.isArray(config && config.domains) ? config.domains : []);

  const graph = options._graph || revisionGraph(entries);
  const validatedPrefix = options._retirementEligibleSources instanceof Set
    ? options._retirementEligibleSources
    : validatedEffectivePrefix(entries, graph, config, options._retirementValidationDiagnostics);
  for (const item of graph.diagnostics) {
    const source = entries.find(doc => doc.path === item.path);
    const candidates = (item.candidates || []).map(candidate => entries.find(doc => doc.path === candidate) || { path: candidate });
    diagnostics.push({ ...item, severity: crossSeverity([...(source ? [source] : []), ...candidates]) });
  }

  for (const doc of governed) {
    if (isPrdCompatibility(doc)) {
      const severity = changedSet.has(doc.path) ? 'error' : 'warning';
      const evidence = changedSet.has(doc.path)
        ? 'changed or newly governed'
        : options._trustedBaseObserved === true ? 'unchanged in the trusted base' : 'not shown changed, but no trusted base proves it is unchanged';
      diagnostics.push(makeDiagnostic('prd-migration-required', severity, doc,
        `pre-migration PRD status ${doc.frontmatter.status} is compatibility-only (${evidence}); adopt the D6.9 revision contract`, doc.frontmatter.id));
      continue;
    }
    if (!changed(doc)) continue;
    if (doc.error) {
      diagnostics.push(makeDiagnostic('malformed-frontmatter', 'error', doc, `frontmatter cannot be parsed: ${doc.error}`));
      continue;
    }
    const data = doc.frontmatter || {};
    if (data.role !== undefined && data.role !== doc.role) {
      diagnostics.push(makeDiagnostic('role-mismatch', 'error', doc, `frontmatter role ${String(data.role)} does not match path role ${String(doc.role)}`));
    }
    if (doc.role === 'prd' && isRevisionPrd(doc) && typeof data.id === 'string') {
      const match = data.id.match(/^PRD-([A-Z][A-Z0-9]{1,9})-\d{3,}$/);
      if (match && !domains.has(match[1])) diagnostics.push(makeDiagnostic('unknown-domain', 'error', doc, `PRD ID domain ${match[1]} is not declared`, data.id));
    }
    const statusSet = isRevisionPrd(doc) ? null : ROLE_STATUSES[doc.role];
    if (statusSet) {
      if (data.status === undefined || data.status === '') diagnostics.push(makeDiagnostic('missing-status', 'error', doc, `status is required for ${doc.role} documents`, data.id));
      else if (typeof data.status !== 'string' || !statusSet.has(data.status)) diagnostics.push(makeDiagnostic('invalid-status', 'error', doc, `status ${String(data.status)} is not valid for ${doc.role}`, data.id));
    }
    if (doc.role === 'adr') {
      if (data.id === undefined || data.id === '') diagnostics.push(makeDiagnostic('missing-id', 'error', doc, 'ADR id is required'));
      else if (typeof data.id !== 'string' || !ADR_ID.test(data.id)) diagnostics.push(makeDiagnostic('invalid-id', 'error', doc, 'ADR id must match <DOMAIN>-NNN', data.id));
      else if (!domains.has(data.id.match(ADR_ID)[1])) diagnostics.push(makeDiagnostic('unknown-domain', 'error', doc, `ADR ID domain ${data.id.match(ADR_ID)[1]} is not declared`, data.id));
    } else if (data.id !== undefined && data.id !== '' && typeof data.id !== 'string') {
      diagnostics.push(makeDiagnostic('invalid-id', 'error', doc, 'document id must be a string', data.id));
    }
    if (data.aliases !== undefined && data.aliases !== '') {
      if (!Array.isArray(data.aliases)) {
        diagnostics.push(makeDiagnostic('invalid-alias', 'error', doc, `document aliases must be a list, received scalar ${JSON.stringify(data.aliases)}`));
      } else {
        for (const alias of data.aliases) {
          const aliasPattern = isRevisionPrd(doc) ? PRD_ID : ANY_ID;
          if (typeof alias !== 'string' || alias.startsWith('legacy:') || !aliasPattern.test(alias) || alias === data.id) {
            diagnostics.push(makeDiagnostic('invalid-alias', 'error', doc, `invalid document alias ${String(alias)}`, typeof alias === 'string' ? alias : undefined));
          }
        }
      }
    }
  }

  // Canonical document IDs occupy one active namespace; legacy IDs do not.
  const idGroups = new Map();
  for (const doc of governed) {
    if (isPrdCompatibility(doc)) continue;
    const id = doc.frontmatter && doc.frontmatter.id;
    if (typeof id !== 'string' || !id || doc.error) continue;
    if (!idGroups.has(id)) idGroups.set(id, []);
    idGroups.get(id).push(doc);
  }
  for (const [id, group] of idGroups) {
    if (group.length < 2) continue;
    if (group.every(isRevisionPrd) && group.every(doc => doc.frontmatter.id === id)) continue;
    const severity = crossSeverity(group);
    const paths = [...new Set(group.map(item => item.path))].sort(compareText);
    for (const doc of group.slice().sort((a, b) => compareText(a.path, b.path))) {
      const candidates = paths.filter(candidate => candidate !== doc.path);
      diagnostics.push(makeDiagnostic('duplicate-id', severity, doc, `canonical ID ${id} is also used by ${candidates.join(', ')}`, id, candidates));
    }
  }

  const reqs = reqDeclarations(entries, graph);
  const reqGroups = new Map();
  for (const declaration of reqs) {
    if (!reqGroups.has(declaration.id)) reqGroups.set(declaration.id, []);
    reqGroups.get(declaration.id).push(declaration);
    const domain = declaration.id.match(REQ_ID)[1];
    if (!domains.has(domain) && changed(declaration.doc)) diagnostics.push(makeDiagnostic('unknown-domain', 'error', declaration.doc, `REQ ID domain ${domain} is not declared`, declaration.id));
    for (const alias of declaration.aliases) {
      if ((typeof alias !== 'string' || alias.startsWith('legacy:') || !ANY_ID.test(alias) || alias === declaration.id) && changed(declaration.doc)) {
        diagnostics.push(makeDiagnostic('invalid-alias', 'error', declaration.doc, `invalid REQ alias ${String(alias)}`, typeof alias === 'string' ? alias : undefined));
      }
    }
  }
  for (const [id, group] of reqGroups) {
    if (group.length < 2) continue;
    const severity = crossSeverity(group.map(item => item.doc));
    const paths = [...new Set(group.map(item => item.doc.path))].sort(compareText);
    for (const docPath of paths) {
      const doc = group.find(item => item.doc.path === docPath).doc;
      const candidates = paths.filter(candidate => candidate !== docPath);
      diagnostics.push(makeDiagnostic('duplicate-req', severity, doc, `requirement ${id} is also defined by ${candidates.join(', ') || 'another definition in this document'}`, id, candidates));
    }
  }

  // Alias uniqueness includes document IDs and REQ IDs/aliases, but excludes archives.
  const claims = new Map();
  function addClaim(name, doc, kind, canonical) {
    if (typeof name !== 'string' || !name) return;
    if (!claims.has(name)) claims.set(name, []);
    claims.get(name).push({ name, doc, kind, canonical });
  }
  const effectiveRevisionDocs = new Set(graph.currentById.values());
  for (const doc of governed) {
    if (isPrdCompatibility(doc)) continue;
    if (isRevisionPrd(doc) && !effectiveRevisionDocs.has(doc)) continue;
    if (!doc.frontmatter || doc.error) continue;
    addClaim(doc.frontmatter.id, doc, 'document', true);
    if (isRevisionPrd(doc)) {
      const logicalId = graph.logicalIdByDoc.get(doc);
      for (const name of graph.namesByLogicalId.get(logicalId) || []) {
        if (name !== doc.frontmatter.id) addClaim(name, doc, 'document', false);
      }
    } else {
      for (const alias of asList(doc.frontmatter.aliases)) if (typeof alias === 'string') addClaim(alias, doc, 'document', false);
    }
  }
  for (const declaration of reqs) {
    addClaim(declaration.id, declaration.doc, 'requirement', true);
    for (const alias of declaration.aliases) addClaim(alias, declaration.doc, 'requirement', false);
  }
  for (const [name, group] of claims) {
    const aliasClaims = group.filter(item => !item.canonical);
    if (!aliasClaims.length || group.length < 2) continue;
    const involved = group.map(item => item.doc);
    const severity = crossSeverity(involved);
    const paths = [...new Set(involved.map(doc => doc.path))].sort(compareText);
    for (const docPath of paths) {
      const doc = involved.find(item => item.path === docPath);
      const candidates = paths.filter(candidate => candidate !== docPath);
      diagnostics.push(makeDiagnostic('alias-collision', severity, doc, `ID ${name} collides with another canonical ID or alias`, name, candidates));
    }
  }

  const allReqIds = new Set(reqs.flatMap(item => [item.id, ...item.aliases]));
  const edges = [];
  const unresolvedSeen = new Set();
  function unresolved(code, source, ref, result, message) {
    const key = `${source.path}\0${String(ref)}`;
    if (unresolvedSeen.has(key)) return;
    unresolvedSeen.add(key);
    const candidates = (result.candidates || []).map(doc => doc.path).sort(compareText);
    const detail = message || result.message || `reference ${String(ref)} cannot be resolved`;
    const involved = [source];
    let basePaths = [];
    if (typeof ref === 'string' && ref.startsWith('legacy:')) {
      const selector = ref.slice('legacy:'.length);
      const at = selector.indexOf('@');
      const id = at < 0 ? selector : selector.slice(0, at);
      if (at >= 0) {
        const archivePath = selector.slice(at + 1);
        if (validLegacySelectorPath(archivePath)) involved.push({ path: archivePath });
      }
      basePaths = options._baseIdPaths ? options._baseIdPaths.get(id) || [] : [];
    } else if (options._baseIdPaths) {
      const identity = String(ref || '').match(/^(PRD-[A-Z][A-Z0-9]{1,9}-\d{3,}|REQ-[A-Z][A-Z0-9]{1,9}-\d{3,}|[A-Z][A-Z0-9]{1,9}-\d{3,})(?:@r[1-9]\d*)?(?:#.*)?$/);
      basePaths = identity ? options._baseIdPaths.get(identity[1]) || [] : [];
    }
    for (const targetPath of basePaths) if (!entries.some(doc => doc.path === targetPath)) involved.push({ path: targetPath });
    const allCandidates = [...new Set([...candidates, ...basePaths.filter(targetPath => !entries.some(doc => doc.path === targetPath))])].sort(compareText);
    diagnostics.push(makeDiagnostic(code || result.error || 'unresolved-ref', crossSeverity(involved), source, detail, ref, allCandidates));
  }

  for (const doc of governed) {
    if (doc.error || !doc.frontmatter) continue;
    const supersedes = asList(doc.frontmatter.supersedes);
    for (const ref of supersedes) {
      if (typeof ref !== 'string') { unresolved('unresolved-ref', doc, ref, { candidates: [] }, 'supersedes entries must be string references'); continue; }
      const result = resolveRef(entries, ref, { graph });
      if (!result.doc) { unresolved(result.error, doc, ref, result); continue; }
      const target = result.doc;
      const eligibility = supersessionEligibility(doc, target, ref, validatedPrefix, graph);
      const edge = { source: doc, target, ref, ...eligibility };
      edges.push(edge);
      if (target.path === doc.path) {
        diagnostics.push(makeDiagnostic('supersede-cycle', crossSeverity([doc]), doc, `${doc.path} supersedes itself`, doc.frontmatter.id));
      } else if (edge.effective && !edge.retirement && !target.legacy && (!target.frontmatter || target.frontmatter.status !== 'superseded')) {
        diagnostics.push(makeDiagnostic('supersede-status-mismatch', crossSeverity([doc, target]), doc, `${target.path} must have status superseded`, target.frontmatter && target.frontmatter.id));
      }
    }
  }

  // Supersession cycles are diagnosed per strongly connected component: each
  // component is one cycle, so its members' changed paths alone decide severity
  // and only sibling component members are listed as candidates.
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source.path)) adjacency.set(edge.source.path, []);
    if (!edge.target.legacy) adjacency.get(edge.source.path).push(edge.target.path);
  }
  const index = new Map();
  const lowlink = new Map();
  const stackNodes = [];
  const onStack = new Set();
  let counter = 0;
  const components = [];
  function strongconnect(node) {
    index.set(node, counter);
    lowlink.set(node, counter);
    counter++;
    stackNodes.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) || []) {
      if (!index.has(next)) {
        strongconnect(next);
        lowlink.set(node, Math.min(lowlink.get(node), lowlink.get(next)));
      } else if (onStack.has(next)) {
        lowlink.set(node, Math.min(lowlink.get(node), index.get(next)));
      }
    }
    if (lowlink.get(node) === index.get(node)) {
      const component = [];
      for (;;) {
        const member = stackNodes.pop();
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      components.push(component);
    }
  }
  for (const node of adjacency.keys()) if (!index.has(node)) strongconnect(node);
  const docByPath = new Map(entries.map(doc => [doc.path, doc]));
  for (const component of components) {
    if (component.length < 2) continue;
    const members = component.slice().sort(compareText);
    const involved = members.map(member => docByPath.get(member)).filter(Boolean);
    const severity = crossSeverity(involved);
    for (const memberPath of members) {
      const doc = docByPath.get(memberPath);
      if (!doc || edges.some(edge => edge.source.path === memberPath && edge.target.path === memberPath)) continue;
      diagnostics.push(makeDiagnostic('supersede-cycle', severity, doc, `supersession cycle includes ${members.join(', ')}`, doc.frontmatter && doc.frontmatter.id, members.filter(item => item !== memberPath)));
    }
  }

  // Scan prose for references, excluding fenced examples. REQ references get a
  // dedicated missing-req diagnostic when no active PRD defines that ID.
  const referencePattern = /(?:^|[^A-Za-z0-9_-])((?:legacy:)?(?:PRD-[A-Z][A-Z0-9]{1,9}-\d{3,}|REQ-[A-Z][A-Z0-9]{1,9}-\d{3,}|[A-Z][A-Z0-9]{1,9}-\d{3,})(?:[@#][^\s`<>()\[\]{}]+)?)/g;
  for (const doc of governed) {
    if (doc.error) continue;
    const body = withoutFencedCode(doc.body || '');
    const seen = new Set();
    for (const line of body.split(/\r?\n/)) {
      if (/^#{1,6}[ \t]+REQ-[A-Z][A-Z0-9]{1,9}-\d{3,}/.test(line)) continue;
      for (const match of line.matchAll(referencePattern)) {
      const ref = match[1].replace(/[.,;:!?]+$/, '');
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (ref.startsWith('REQ-') && !allReqIds.has(ref)) {
        unresolved('missing-req', doc, ref, { error: 'missing-req', candidates: [] }, `requirement ${ref} is referenced but is not defined in an active PRD`);
        continue;
      }
      const result = resolveRef(entries, ref, { graph });
      // A duplicate canonical ID or alias already has a structural diagnostic;
      // avoid adding a second unresolved-reference finding for prose that names
      // that conflicted identity.
      if (result.error === 'unresolved-ref' && result.candidates && result.candidates.length > 1 && result.candidates.some(candidate => !candidate.legacy)) continue;
      if (!result.doc) unresolved(result.error, doc, ref, result);
      }
    }
  }

  // Conflicts are owner-recorded; only an eligible supersession between the
  // pair resolves them. The declaration is kept on the document that records it.
  const effectivePairs = new Set(edges.filter(edge => edge.effective).map(edge => `${edge.source.path}\0${edge.target.path}`));
  for (const doc of governed) {
    if (doc.error || !doc.frontmatter) continue;
    for (const ref of asList(doc.frontmatter.conflicts_with)) {
      const result = resolveRef(entries, ref, { graph });
      if (!result.doc) { unresolved(result.error, doc, ref, result); continue; }
      const target = result.doc;
      if (target.path === doc.path || effectivePairs.has(`${doc.path}\0${target.path}`) || effectivePairs.has(`${target.path}\0${doc.path}`)) continue;
      diagnostics.push(makeDiagnostic('recorded-conflict', crossSeverity([doc, target]), doc, `recorded conflict between ${doc.frontmatter.id || doc.path} and ${target.frontmatter && target.frontmatter.id || target.path}`, ref, [target.path]));
    }
  }

  return sortDiagnostics(diagnostics);
}

function workingStoredBytes(root, relativePath, bytes, rules = null) {
  const source = Buffer.from(bytes);
  if (!root || !relativePath || !source.includes(0x0d)) return source;
  const currentRules = rules || readWorkingTreeRules(root, [relativePath]);
  const attrs = currentRules.attributes.get(relativePath) || {};
  const textValue = attrs.text || 'unspecified';
  const eolValue = attrs.eol || 'unspecified';
  if (textValue === 'unset') return source;
  const forcedText = textValue === 'set' || textValue === 'auto' || eolValue === 'lf' || eolValue === 'crlf';
  const autocrlfText = textValue === 'unspecified' && ['true', 'input'].includes(currentRules.autocrlf);
  if (!forcedText && !autocrlfText) return source;
  const automaticText = textValue === 'auto' || autocrlfText;
  if (automaticText && source.includes(0)) return source;
  return Buffer.from(source.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function readWorkingTreeRules(root, paths) {
  const attributes = new Map();
  const uniquePaths = [...new Set((paths || []).filter(item => typeof item === 'string' && item))].sort(compareText);
  let autocrlf = '';
  if (!root || !uniquePaths.length) return { attributes, autocrlf };
  const batches = [];
  let batch = [];
  let byteCount = 0;
  for (const relativePath of uniquePaths) {
    const length = Buffer.byteLength(relativePath, 'utf8') + 1;
    if (batch.length && (batch.length >= 2048 || byteCount + length > 1024 * 1024)) {
      batches.push(batch);
      batch = [];
      byteCount = 0;
    }
    batch.push(relativePath);
    byteCount += length;
  }
  if (batch.length) batches.push(batch);
  for (const group of batches) {
    try {
      const input = Buffer.from(`${group.join('\0')}\0`, 'utf8');
      const output = execFileSync('git', ['-C', root, 'check-attr', '-z', '--stdin', 'text', 'eol'], { encoding: 'buffer', input, maxBuffer: 8 * 1024 * 1024 });
      const fields = output.toString('utf8').split('\0');
      for (let index = 0; index + 2 < fields.length; index += 3) {
        const [relativePath, attribute, value] = fields.slice(index, index + 3);
        if (!relativePath || !attribute) continue;
        if (!attributes.has(relativePath)) attributes.set(relativePath, {});
        attributes.get(relativePath)[attribute] = value;
      }
    } catch { /* outside a Git worktree: retain caller-provided bytes */ }
  }
  try {
    autocrlf = execFileSync('git', ['-C', root, 'config', '--get', 'core.autocrlf'], { encoding: 'utf8', maxBuffer: 4096 }).trim();
  } catch { /* unset */ }
  return { attributes, autocrlf };
}

function gitOutput(root, args, encoding = 'buffer') {
  return execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 });
}

function parseInventoryDoc(relativePath, bytes) {
  const parsed = parseFrontmatter(Buffer.from(bytes).toString('utf8'));
  if (parsed.error || !parsed.data || typeof parsed.data.id !== 'string') return null;
  return {
    id: parsed.data.id,
    revision: parsed.data.revision,
    path: relativePath,
    status: parsed.data.status,
    bytes: Buffer.from(bytes),
    frontmatter: parsed.data,
    body: parsed.body
  };
}

function scanWorkspaceFiles(root, scope = null) {
  if (!root) return [];
  const workspace = path.resolve(root);
  const scoped = scope !== null;
  const globs = Array.isArray(scope && scope.globs) ? scope.globs.filter(value => typeof value === 'string') : [];
  const exactPaths = Array.isArray(scope && scope.paths) ? scope.paths.filter(value => typeof value === 'string') : [];
  const files = [];
  function walk(directory, relativeDirectory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!scoped || directoryCanContainMatch(relative, globs, exactPaths)) walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (scoped && !matchesAny(relative, globs) && !exactPaths.includes(relative)) continue;
      let bytes;
      try { bytes = fs.readFileSync(absolute); } catch { continue; }
      files.push({ relative, bytes });
    }
  }
  walk(workspace, '');
  const rules = readWorkingTreeRules(workspace, files.filter(item => item.bytes.includes(0x0d)).map(item => item.relative));
  return files.map(item => ({ path: item.relative, bytes: workingStoredBytes(workspace, item.relative, item.bytes, rules) }));
}

function scanWorkspaceInventory(root) {
  return scanWorkspaceFiles(root).map(item => parseInventoryDoc(item.path, item.bytes)).filter(Boolean);
}

function provenancePaths(docs) {
  const paths = new Set();
  for (const item of docs || []) {
    let frontmatter = item && item.frontmatter;
    if ((!frontmatter || typeof frontmatter !== 'object') && item && typeof item.path === 'string') {
      const bytes = item.bytes || item.storedBytes;
      if (bytes) frontmatter = parseInventoryDoc(item.path, bytes)?.frontmatter;
    }
    if (!frontmatter || typeof frontmatter !== 'object') continue;
    const candidates = [frontmatter.migration_record, frontmatter.approval && frontmatter.approval.ref];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && validLegacySelectorPath(candidate) && !/^https?:\/\//i.test(candidate)) paths.add(candidate);
    }
  }
  return [...paths];
}

function readGitBlobBatches(root, records) {
  const result = new Map();
  const maxBatchBytes = 16 * 1024 * 1024;
  const maxBatchObjects = 128;
  const maxBlobBytes = 32 * 1024 * 1024;
  const batches = [];
  let batch = [];
  let batchBytes = 0;
  for (const record of records) {
    if (!Number.isInteger(record.size) || record.size < 0 || record.size > maxBlobBytes) throw new Error(`base blob ${record.oid} exceeds the bounded read limit`);
    const estimated = record.size + 128;
    if (batch.length && (batch.length >= maxBatchObjects || batchBytes + estimated > maxBatchBytes)) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(record);
    batchBytes += estimated;
  }
  if (batch.length) batches.push(batch);
  for (const group of batches) {
    const input = Buffer.from(`${group.map(item => item.oid).join('\n')}\n`, 'ascii');
    const maxOutput = Math.min(40 * 1024 * 1024, group.reduce((total, item) => total + item.size + 128, 0));
    const output = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { encoding: 'buffer', input, maxBuffer: Math.max(1024 * 1024, maxOutput) });
    let offset = 0;
    for (const expected of group) {
      const newline = output.indexOf(0x0a, offset);
      if (newline < 0) throw new Error(`malformed cat-file header for ${expected.oid}`);
      const header = output.subarray(offset, newline).toString('ascii').split(' ');
      if (header.length !== 3 || header[0] !== expected.oid || header[1] !== 'blob' || Number(header[2]) !== expected.size) {
        throw new Error(`unexpected cat-file response for ${expected.oid}`);
      }
      const start = newline + 1;
      const end = start + expected.size;
      if (end >= output.length || output[end] !== 0x0a) throw new Error(`truncated cat-file body for ${expected.oid}`);
      result.set(expected.oid, Buffer.from(output.subarray(start, end)));
      offset = end + 1;
    }
    if (offset !== output.length) throw new Error('cat-file batch returned trailing bytes');
  }
  return result;
}

function configPathsForWorkspace(root, explicitConfigPath = null) {
  const configPaths = new Set([
    '.agents/harness-everything/project-docs.json',
    'project-docs.json',
    'lifecycle-config.json',
    ...['.claude', '.cursor', '.github', '.codex', '.continue'].map(home => `${home}/harness-everything/manifest.json`)
  ]);
  if (typeof explicitConfigPath === 'string' && explicitConfigPath) {
    const absoluteConfigPath = path.isAbsolute(explicitConfigPath)
      ? path.resolve(explicitConfigPath)
      : path.resolve(root, explicitConfigPath);
    const relativeConfigPath = path.relative(path.resolve(root), absoluteConfigPath).split(path.sep).join('/');
    if (relativeConfigPath && relativeConfigPath !== '..' && !relativeConfigPath.startsWith('../') && !path.isAbsolute(relativeConfigPath)) {
      configPaths.add(relativeConfigPath);
    }
  }
  return configPaths;
}

function readWorkspaceConfigSources(root, explicitConfigPath, fallbackConfig) {
  if (!root) return [fallbackConfig];
  const sources = [];
  const resolvedExplicitPath = typeof explicitConfigPath === 'string' && explicitConfigPath
    ? path.resolve(explicitConfigPath)
    : null;
  let explicitSourceLoaded = false;
  for (const relativePath of configPathsForWorkspace(root, explicitConfigPath)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    if (!fs.existsSync(absolutePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const source = parsed.projectDocs && typeof parsed.projectDocs === 'object' && !Array.isArray(parsed.projectDocs)
        ? parsed.projectDocs
        : parsed;
      sources.push(source);
      if (resolvedExplicitPath && path.resolve(absolutePath) === resolvedExplicitPath) explicitSourceLoaded = true;
    } catch { /* a malformed candidate source cannot grant or cancel authority */ }
  }
  if (!explicitSourceLoaded) sources.unshift(fallbackConfig);
  return sources.length ? sources : [fallbackConfig];
}

function readGitBaseInventory(root, baseRef, config, explicitConfigPath = null) {
  if (!root || typeof baseRef !== 'string' || !baseRef.trim()) return { available: false, inventory: [], files: [] };
  try {
    const commit = gitOutput(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${baseRef}^{commit}`], 'utf8').trim();
    const entries = gitOutput(root, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit], 'buffer').toString('utf8').split('\0').filter(Boolean);
    const tree = [];
    for (const entry of entries) {
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      const header = entry.slice(0, tab).match(/^(\d+) (blob|commit) ([0-9a-f]+)\s+(\d+)$/);
      if (!header) continue;
      const [, mode, type, oid, sizeText] = header;
      const relative = entry.slice(tab + 1);
      if (type !== 'blob' || !/^[0-9a-f]{40,64}$/.test(oid)) continue;
      const size = Number(sizeText);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid base blob size for ${relative}`);
      tree.push({ mode, oid, path: relative, size });
    }
    const configPaths = configPathsForWorkspace(root, explicitConfigPath);
    const configRecords = tree.filter(item => configPaths.has(item.path));
    const currentGoverned = Array.isArray(config && config.governed) ? config.governed.map(item => item && item.path).filter(item => typeof item === 'string') : [];
    const currentLegacy = Array.isArray(config && config.legacy) ? config.legacy : [];
    // Conventional PRD paths remain conservative artifact discovery only.
    // Frozen authority is selected later from the trusted base configuration.
    const isRelevantDocument = item => matchesAny(item.path, currentGoverned)
      || matchesAny(item.path, currentLegacy)
      || item.path.startsWith('docs/prd/') && /\.md$/i.test(item.path);
    const initialDocuments = tree.filter(isRelevantDocument);
    const initial = [...new Map([...configRecords, ...initialDocuments].map(item => [item.path, item])).values()];
    const initialBlobs = readGitBlobBatches(root, initial);
    const baseConfigs = [];
    for (const item of configRecords) {
      const bytes = initialBlobs.get(item.oid);
      if (!bytes) continue;
      try {
        const parsed = JSON.parse(bytes.toString('utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const projectDocs = parsed.projectDocs && typeof parsed.projectDocs === 'object' && !Array.isArray(parsed.projectDocs)
            ? parsed.projectDocs
            : parsed;
          baseConfigs.push(projectDocs);
        }
      } catch { /* malformed historical config cannot add scan globs */ }
    }
    const baseGoverned = baseConfigs.flatMap(item => Array.isArray(item.governed) ? item.governed.map(entry => entry && entry.path).filter(value => typeof value === 'string') : []);
    const baseLegacy = baseConfigs.flatMap(item => Array.isArray(item.legacy) ? item.legacy : []);
    const selectedDocuments = tree.filter(item => isRelevantDocument(item)
      || matchesAny(item.path, baseGoverned)
      || matchesAny(item.path, baseLegacy));
    const selectedByPath = new Map(selectedDocuments.map(item => [item.path, item]));
    const extraDocuments = [...selectedByPath.values()].filter(item => !initialBlobs.has(item.oid));
    const extraBlobs = readGitBlobBatches(root, extraDocuments);
    const blobByOid = new Map([...initialBlobs, ...extraBlobs]);
    const inventory = [];
    const files = [];
    for (const item of selectedByPath.values()) {
      const bytes = blobByOid.get(item.oid);
      if (!bytes) continue;
      const relative = item.path;
      files.push({ path: relative, bytes: Buffer.from(bytes) });
      const record = parseInventoryDoc(relative, bytes);
      if (record) inventory.push(record);
    }
    const baseConfig = baseConfigs.length ? {
      governed: baseConfigs.flatMap(item => Array.isArray(item.governed) ? item.governed : []),
      legacy: baseConfigs.flatMap(item => Array.isArray(item.legacy) ? item.legacy : [])
    } : null;
    return { available: true, commit, inventory, files, config: baseConfig, configSources: baseConfigs };
  } catch {
    return { available: false, inventory: [], files: [], configSources: [] };
  }
}

function baseIdPaths(inventory, config, baseConfigSources = null) {
  const result = new Map();
  const add = (id, relative) => {
    if (typeof id !== 'string' || !id || typeof relative !== 'string') return;
    if (!result.has(id)) result.set(id, []);
    if (!result.get(id).includes(relative)) result.get(id).push(relative);
  };
  for (const item of inventory || []) {
    if (!item || typeof item.id !== 'string' || typeof item.path !== 'string') continue;
    add(item.id, item.path);
    for (const alias of asList(item.frontmatter && item.frontmatter.aliases)) add(alias, item.path);
    const isPrdArtifact = (Array.isArray(baseConfigSources)
      ? governedPrdPath(item.path, baseConfigSources)
      : governedPrdPath(item.path, [config]))
      || item.frontmatter && item.frontmatter.role === 'prd'
      || item.frontmatter && Object.prototype.hasOwnProperty.call(item.frontmatter, 'revision')
      || item.path.startsWith('docs/prd/') && !item.path.includes('/legacy/');
    if (isPrdArtifact && item.frontmatter && item.body !== undefined) {
      const doc = { ...item, role: 'prd', legacy: false };
      for (const requirement of parseRequirementBlocks(doc)) {
        add(requirement.id, item.path);
        for (const alias of requirement.aliases) add(alias, item.path);
      }
    }
  }
  for (const paths of result.values()) paths.sort(compareText);
  return result;
}

function positivelyGovernedPath(relativePath, configSources, role = null) {
  const sources = Array.isArray(configSources) ? configSources : [configSources];
  return sources.some(config => {
    const governedGlobs = (Array.isArray(config && config.governed) ? config.governed : [])
      .filter(item => item && typeof item.path === 'string' && (!role || item.role === role))
      .map(item => item.path);
    return matchesAny(relativePath, governedGlobs)
      && !matchesAny(relativePath, Array.isArray(config && config.legacy) ? config.legacy : []);
  });
}

function governedPrdPath(relativePath, configSources) {
  return positivelyGovernedPath(relativePath, configSources, 'prd');
}

function isLegacyInConfigSources(relativePath, configSources) {
  const sources = Array.isArray(configSources) ? configSources : configSources ? [configSources] : [];
  return sources.some(config => matchesAny(relativePath, Array.isArray(config && config.legacy) ? config.legacy : []))
    && !positivelyGovernedPath(relativePath, sources);
}

function immutableBasePrdInventory(inventory, baseConfig, explicitInventory = false) {
  const entries = Array.isArray(inventory) ? inventory : [];
  if (explicitInventory) return entries;
  return entries.filter(item => item && typeof item.path === 'string' && governedPrdPath(item.path, baseConfig));
}

function immutabilityDiagnostics(baseInventory, candidateInventory) {
  const diagnostics = [];
  const candidateByKey = new Map();
  for (const item of candidateInventory || []) {
    if (!Number.isInteger(item.revision) || typeof item.id !== 'string') continue;
    const key = `${item.id}\0${item.revision}`;
    if (!candidateByKey.has(key)) candidateByKey.set(key, []);
    candidateByKey.get(key).push(item);
  }
  for (const base of baseInventory || []) {
    if (base.status !== 'effective' || !Number.isInteger(base.revision) || typeof base.id !== 'string') continue;
    const matches = candidateByKey.get(`${base.id}\0${base.revision}`) || [];
    if (!matches.length) {
      diagnostics.push({ code: 'immutable-revision-deleted', severity: 'error', path: base.path, id: base.id, message: `effective revision ${base.id}@r${base.revision} was deleted or moved outside the candidate inventory` });
      continue;
    }
    const exact = matches.find(item => item.path === base.path && Buffer.from(item.bytes).equals(Buffer.from(base.bytes)));
    if (!exact) {
      const candidate = matches.slice().sort((a, b) => compareText(a.path, b.path))[0];
      diagnostics.push({ code: 'immutable-revision-modified', severity: 'error', path: candidate.path, id: base.id, message: `effective revision ${base.id}@r${base.revision} must retain its path and stored bytes`, candidates: [base.path] });
    }
  }
  return diagnostics;
}

function frontmatterEnvelope(source) {
  const text = String(source);
  const lines = text.split('\n');
  if ((lines[0] || '').replace(/\r$/, '') !== '---') return '';
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, '');
    if (/^---[ \t]*$/.test(line) || /^\.\.\.[ \t]*$/.test(line)) return lines.slice(0, index + 1).join('\n');
  }
  return text;
}

function legacyHistoryDiagnostics(baseFiles, candidateFiles, candidateConfigSources, baseConfigSources = null) {
  const candidateByPath = new Map((candidateFiles || []).filter(item => item && typeof item.path === 'string')
    .map(item => [item.path, Buffer.from(item.bytes || [])]));
  const legacyBaseFiles = (baseFiles || []).filter(item => item && typeof item.path === 'string'
    && (Array.isArray(baseConfigSources)
      ? isLegacyInConfigSources(item.path, baseConfigSources)
      : item.legacy === true));
  const diagnostics = [];
  for (const base of legacyBaseFiles) {
    const candidateBytes = candidateByPath.get(base.path);
    // Deleted and moved archives are handled by existing explicit legacy ref escalation.
    if (!candidateBytes) continue;
    const baseBytes = Buffer.from(base.bytes || []);
    const baseText = baseBytes.toString('utf8');
    const candidateText = candidateBytes.toString('utf8');
    const baseFrontmatter = parseFrontmatter(baseText);
    const candidateFrontmatter = parseFrontmatter(candidateText);
    const problems = [];
    if (!isLegacyInConfigSources(base.path, candidateConfigSources)) problems.push('archive is reclassified outside legacy scope');
    if (baseFrontmatter.error) {
      if (!candidateFrontmatter.error || frontmatterEnvelope(baseText) !== frontmatterEnvelope(candidateText)) {
        problems.push('frontmatter differs from the unparseable trusted-base frontmatter');
      }
    } else if (candidateFrontmatter.error) {
      problems.push(`frontmatter no longer parses: ${candidateFrontmatter.error}`);
    } else if (!isDeepStrictEqual(baseFrontmatter.data, candidateFrontmatter.data)) {
      problems.push('parsed frontmatter differs from the trusted base');
    }
    if (!problems.length) continue;
    const id = baseFrontmatter.data && baseFrontmatter.data.id
      || candidateFrontmatter.data && candidateFrontmatter.data.id;
    diagnostics.push({
      code: 'legacy-frozen-modified', severity: 'error', path: base.path,
      ...(typeof id === 'string' ? { id } : {}),
      message: `legacy archive is frozen against normative frontmatter changes: ${problems.join('; ')}`
    });
  }
  return diagnostics;
}

function migrationDiagnostics(docs, root, baseInventory, baseFiles = null, baseConfigSources = null) {
  const diagnostics = [];
  const baseByPath = new Map((baseFiles || baseInventory || []).filter(item => item && typeof item.path === 'string')
    .map(item => [item.path, { ...item, bytes: Buffer.from(item.bytes || []) }]));
  const livingSources = [...baseByPath.values()].filter(item => {
    const parsed = parseFrontmatter(item.bytes.toString('utf8'));
    return !parsed.error
      && (Array.isArray(baseConfigSources)
        ? governedPrdPath(item.path, baseConfigSources)
        : roleAtPath(item.path, null, true) === 'prd')
      && !Object.prototype.hasOwnProperty.call(parsed.data || {}, 'revision')
      && !Object.prototype.hasOwnProperty.call(parsed.data || {}, 'previous_revision')
      && ['active', 'superseded'].includes(parsed.data && parsed.data.status);
  });
  const candidates = (docs || []).filter(doc => isRevisionPrd(doc)
    && doc.frontmatter.revision === 1
    && (doc.frontmatter.previous_revision === undefined || doc.frontmatter.previous_revision === null));
  for (const doc of candidates) {
    const samePathSource = livingSources.find(item => item.path === doc.path);
    const sameIdentitySources = livingSources.filter(item => {
      const parsed = parseFrontmatter(item.bytes.toString('utf8'));
      return parsed.data && parsed.data.id === doc.frontmatter.id;
    });
    const priorWasLivingPrd = Boolean(samePathSource || sameIdentitySources.length);
    const priorSource = samePathSource || (sameIdentitySources.length === 1 ? sameIdentitySources[0] : null);
    const hasMigrationMetadata = doc.frontmatter.migrated_from_digest !== undefined
      || doc.frontmatter.migration_record !== undefined;
    if (!priorWasLivingPrd && !hasMigrationMetadata) continue;
    if (priorWasLivingPrd && (!priorSource || doc.frontmatter.migrated_from_digest === undefined || doc.frontmatter.migration_record === undefined)) {
      diagnostics.push(makeDiagnostic('migration-record-missing', 'error', doc,
        'existing living PRD adoption requires an unambiguous source, migrated_from_digest, and a migration_record', doc.frontmatter.id));
      continue;
    }
    const recordPath = doc.frontmatter.migration_record;
    if (typeof recordPath !== 'string' || !validLegacySelectorPath(recordPath)) {
      diagnostics.push(makeDiagnostic('migration-record-missing', 'error', doc, 'baseline migration_record must name an in-repository JSON record', doc.frontmatter.id));
      continue;
    }
    if (!root) {
      diagnostics.push(makeDiagnostic('migration-record-missing', 'error', doc, `migration record ${recordPath} cannot be checked without a workspace`, doc.frontmatter.id));
      continue;
    }
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(root, ...recordPath.split('/')), 'utf8')); } catch {
      diagnostics.push(makeDiagnostic('migration-record-missing', 'error', doc, `migration record ${recordPath} cannot be read`, doc.frontmatter.id));
      continue;
    }
    const source = typeof record.source === 'string' ? baseByPath.get(record.source) : null;
    if (!source || !Buffer.isBuffer(source.bytes)
      || (priorSource && record.source !== priorSource.path)
      || (!priorSource && record.source !== doc.path && !livingSources.some(item => item.path === record.source))) {
      diagnostics.push(makeDiagnostic('migration-record-mismatch', 'error', doc, `migration source ${String(record.source)} is absent from the trusted base`, doc.frontmatter.id));
      continue;
    }
    const priorBytes = Buffer.from(source.bytes);
    const priorDigest = sha256(priorBytes);
    let recordMatches = record.record === 'prd-baseline-migration'
      && record.id === doc.frontmatter.id
      && record.revision === 1
      && record.source === doc.path
      && record.migrated_from_digest === doc.frontmatter.migrated_from_digest
      && record.migrated_from_digest === priorDigest
      && record.approved_by === (doc.frontmatter.approval && doc.frontmatter.approval.by);
    const priorFrontmatter = parseFrontmatter(priorBytes.toString('utf8'));
    const currentBody = Buffer.from(doc.body || '', 'utf8');
    const priorBody = Buffer.from(priorFrontmatter.body || '', 'utf8');
    if (!priorFrontmatter || priorFrontmatter.error || !priorBody.equals(currentBody)) recordMatches = false;
    if (!recordMatches) diagnostics.push(makeDiagnostic('migration-record-mismatch', 'error', doc, `migration record ${recordPath} does not bind the metadata-only baseline adoption`, doc.frontmatter.id));
  }
  return diagnostics;
}

function transitionDiagnostics(docs, baseInventory, root, candidateGraph = null) {
  const diagnostics = [];
  const baseDocs = (baseInventory || []).filter(item => item && item.frontmatter && item.frontmatter.revision)
    .map(item => ({ path: item.path, role: 'prd', legacy: false, frontmatter: item.frontmatter, body: item.body || '', storedBytes: item.bytes }));
  const baseGraph = revisionGraph(baseDocs);
  const liveGraph = candidateGraph || revisionGraph(docs);
  for (const base of baseDocs.filter(doc => doc.frontmatter.status === 'approved')) {
    const logicalId = baseGraph.logicalIdByDoc.get(base);
    const names = baseGraph.namesByLogicalId.get(logicalId) || new Set([base.frontmatter.id]);
    const candidateLogicalIds = new Set([...names].flatMap(name => [...(liveGraph.logicalIdsByName.get(name) || [])]));
    const present = [...candidateLogicalIds].some(id => (liveGraph.groups.get(id) || [])
      .some(doc => doc.frontmatter.revision === base.frontmatter.revision));
    if (!present) {
      diagnostics.push(makeDiagnostic('invalid-transition', 'error', base,
        'approved revisions may not be deleted or moved outside the candidate inventory; return to draft or activate explicitly', base.frontmatter.id));
    }
  }
  for (const doc of (docs || []).filter(isRevisionPrd)) {
    const data = doc.frontmatter;
    const logicalId = liveGraph.logicalIdByDoc.get(doc);
    const names = liveGraph.namesByLogicalId.get(logicalId) || new Set([data.id]);
    const baseLogicalIds = new Set([...names].flatMap(name => [...(baseGraph.logicalIdsByName.get(name) || [])]));
    const baseCandidates = [...baseLogicalIds].flatMap(id => (baseGraph.groups.get(id) || []).filter(item => item.frontmatter.revision === data.revision));
    const base = baseCandidates.length === 1 ? baseCandidates[0] : null;
    if (!base) continue;
    const candidateBytes = docBytes(doc);
    if (base.frontmatter.status === 'approved' && data.status === 'approved') {
      if (!candidateBytes.equals(Buffer.from(base.storedBytes)) || doc.path !== base.path) {
        diagnostics.push(makeDiagnostic('invalid-transition', 'error', doc, 'approved revisions are frozen until returned to draft or activated', data.id));
      }
      continue;
    }
    if (base.frontmatter.status === 'approved' && data.status === 'draft') continue;
    if (base.frontmatter.status === 'approved' && !['approved', 'draft', 'effective'].includes(data.status)) {
      diagnostics.push(makeDiagnostic('invalid-transition', 'error', doc, 'approved revisions may only remain approved, return to draft, or activate', data.id));
      continue;
    }
    if (data.status !== 'effective') continue;
    if (base.frontmatter.status !== 'approved' && base.frontmatter.status !== 'effective') {
      diagnostics.push(makeDiagnostic('invalid-transition', 'error', doc, `effective revision must activate from approved, found base status ${String(base.frontmatter.status)}`, data.id));
      continue;
    }
    if (base.frontmatter.status === 'effective') continue;
    const priorProjection = { ...base.frontmatter };
    const nextProjection = { ...data };
    for (const key of ['status', 'effective_at']) { delete priorProjection[key]; delete nextProjection[key]; }
    const candidateBody = Buffer.from(doc.body || '', 'utf8');
    if (doc.path !== base.path
      || sortedJson(priorProjection) !== sortedJson(nextProjection)
      || !Buffer.from(base.body || '', 'utf8').equals(candidateBody)) {
      diagnostics.push(makeDiagnostic('invalid-transition', 'error', doc, 'approved-to-effective activation may change only status and effective_at', data.id));
    }
    const baseLogicalId = baseGraph.logicalIdByDoc.get(base);
    const priorCurrent = baseGraph.currentById.get(baseLogicalId);
    if (priorCurrent && data.previous_revision !== priorCurrent.frontmatter.revision) {
      diagnostics.push(makeDiagnostic('stale-draft-base', 'error', doc, `activation parent ${String(data.previous_revision)} is not the base current effective revision r${priorCurrent.frontmatter.revision}`, data.id));
    }
  }
  return diagnostics;
}

function roleAtPath(relativePath, config, inferDefaultPrd = false) {
  const entry = (Array.isArray(config && config.governed) ? config.governed : [])
    .find(item => item && typeof item.path === 'string' && matchesAny(relativePath, [item.path]));
  if (entry && typeof entry.role === 'string') return entry.role;
  if (inferDefaultPrd && relativePath.startsWith('docs/prd/') && !relativePath.includes('/legacy/')) return 'prd';
  return null;
}

function isLegacyPath(relativePath, config) {
  return matchesAny(relativePath, Array.isArray(config && config.legacy) ? config.legacy : []);
}

function roleInConfigSources(relativePath, configSources) {
  for (const source of Array.isArray(configSources) ? configSources : configSources ? [configSources] : []) {
    const entry = (Array.isArray(source && source.governed) ? source.governed : [])
      .find(item => item && typeof item.path === 'string' && matchesAny(relativePath, [item.path]));
    if (!entry || matchesAny(relativePath, Array.isArray(source.legacy) ? source.legacy : [])) continue;
    if (typeof entry.role === 'string') return entry.role;
  }
  return null;
}

function objectiveChangedPaths(baseFiles, candidateFiles, config, baseConfig, baseConfigSources = null, candidateConfigSources = null) {
  const baseByPath = new Map((baseFiles || []).filter(item => item && typeof item.path === 'string')
    .map(item => [item.path, Buffer.from(item.bytes || [])]));
  const candidateByPath = new Map((candidateFiles || []).filter(item => item && typeof item.path === 'string')
    .map(item => [item.path, Buffer.from(item.bytes || [])]));
  const currentPatterns = [
    ...(Array.isArray(config && config.governed) ? config.governed.map(item => item && item.path) : []),
    ...(Array.isArray(config && config.legacy) ? config.legacy : [])
  ].filter(value => typeof value === 'string');
  const currentSources = Array.isArray(candidateConfigSources) ? candidateConfigSources : [config];
  const basePatterns = [
    ...(Array.isArray(baseConfig && baseConfig.governed) ? baseConfig.governed.map(item => item && item.path) : []),
    ...(Array.isArray(baseConfig && baseConfig.legacy) ? baseConfig.legacy : [])
  ].filter(value => typeof value === 'string');
  if (Array.isArray(baseConfigSources)) {
    basePatterns.push(...baseConfigSources.flatMap(source => [
      ...(Array.isArray(source && source.governed) ? source.governed.map(item => item && item.path) : []),
      ...(Array.isArray(source && source.legacy) ? source.legacy : [])
    ]).filter(value => typeof value === 'string'));
  }
  const paths = new Set([...baseByPath.keys(), ...candidateByPath.keys()]);
  const changed = new Set();
  for (const relativePath of paths) {
    const currentRole = roleInConfigSources(relativePath, currentSources);
    const baseRole = Array.isArray(baseConfigSources)
      ? roleInConfigSources(relativePath, baseConfigSources)
      : roleAtPath(relativePath, baseConfig, !baseConfig);
    const currentLegacy = isLegacyInConfigSources(relativePath, currentSources);
    const baseLegacy = Array.isArray(baseConfigSources)
      ? isLegacyInConfigSources(relativePath, baseConfigSources)
      : isLegacyPath(relativePath, baseConfig);
    const currentInScope = Boolean(currentRole || currentLegacy);
    const baseInScope = Boolean(baseRole || baseLegacy);
    if (!currentInScope && !baseInScope && !matchesAny(relativePath, [...currentPatterns, ...basePatterns])) continue;
    const prior = baseByPath.get(relativePath);
    const current = candidateByPath.get(relativePath);
    if (!prior || !current || !prior.equals(current)) {
      changed.add(relativePath);
      continue;
    }
    const basePrd = Array.isArray(baseConfigSources)
      ? governedPrdPath(relativePath, baseConfigSources)
      : baseRole === 'prd' && !baseLegacy;
    const currentPrd = governedPrdPath(relativePath, currentSources);
    if (currentPrd && !basePrd) changed.add(relativePath);
  }
  return changed;
}

function analyzeDocs(docs, config, options = {}) {
  const entries = Array.isArray(docs) ? docs : [];
  const candidateConfigSources = Array.isArray(options.configSources) ? options.configSources : [config];
  const graph = options._graph || revisionGraph(entries);
  const root = options.workspace || entries.find(doc => typeof doc.workspace === 'string')?.workspace || null;
  const explicitBaseInventory = Array.isArray(options.baseInventory);
  const suppliedBaseConfigSources = Array.isArray(options.baseConfigSources) ? options.baseConfigSources : null;
  let legacyClassificationObserved = true;
  let inventory = null;
  let baseState = null;
  let baseFiles = null;
  let disposition = 'not-observed';
  if (explicitBaseInventory) {
    const inventoryRows = options.baseInventory.filter(item => item && typeof item.path === 'string');
    legacyClassificationObserved = suppliedBaseConfigSources !== null
      || inventoryRows.length > 0 && inventoryRows.every(item => typeof item.legacy === 'boolean');
    baseFiles = options.baseInventory.filter(item => item && typeof item.path === 'string')
      .map(item => ({
        path: item.path,
        bytes: Buffer.from(item.bytes || []),
        ...(typeof item.legacy === 'boolean' ? { legacy: item.legacy } : {})
      }));
    inventory = options.baseInventory.map(item => {
      if (!item || typeof item.path !== 'string') return null;
      return parseInventoryDoc(item.path, Buffer.from(item.bytes || []));
    }).filter(Boolean);
    disposition = 'observed';
  } else if (options.base !== undefined) {
    baseState = readGitBaseInventory(root, options.base, config, options.configPath);
    if (baseState.available) { inventory = baseState.inventory; baseFiles = baseState.files; disposition = 'observed'; }
    else disposition = 'unavailable';
  }
  const resolvedBaseConfigSources = suppliedBaseConfigSources !== null
    ? suppliedBaseConfigSources
    : baseState && Array.isArray(baseState.configSources) && baseState.configSources.length
      ? baseState.configSources
      : null;
  const resolvedBaseConfig = baseState && baseState.config
    || (Array.isArray(resolvedBaseConfigSources) ? {
      governed: resolvedBaseConfigSources.flatMap(source => Array.isArray(source && source.governed) ? source.governed : []),
      legacy: resolvedBaseConfigSources.flatMap(source => Array.isArray(source && source.legacy) ? source.legacy : [])
    } : null);
  const normalizedInventory = inventory || [];
  const candidatePatterns = [
    ...(Array.isArray(config && config.governed) ? config.governed.map(item => item && item.path) : []),
    ...(Array.isArray(config && config.legacy) ? config.legacy : []),
    ...candidateConfigSources.flatMap(source => [
      ...(Array.isArray(source && source.governed) ? source.governed.map(item => item && item.path) : []),
      ...(Array.isArray(source && source.legacy) ? source.legacy : [])
    ]),
    ...(Array.isArray(resolvedBaseConfig && resolvedBaseConfig.governed) ? resolvedBaseConfig.governed.map(item => item && item.path) : []),
    ...(Array.isArray(resolvedBaseConfig && resolvedBaseConfig.legacy) ? resolvedBaseConfig.legacy : []),
    ...(Array.isArray(resolvedBaseConfigSources) ? resolvedBaseConfigSources.flatMap(source => [
      ...(Array.isArray(source && source.governed) ? source.governed.map(item => item && item.path) : []),
      ...(Array.isArray(source && source.legacy) ? source.legacy : [])
    ]) : []),
    // Discover conventional artifacts, but do not grant them base authority.
    'docs/prd/**'
  ].filter(value => typeof value === 'string');
  const candidatePaths = [...new Set([
    ...entries.map(doc => doc.path),
    ...(baseFiles || []).map(item => item.path),
    ...provenancePaths(entries),
    ...provenancePaths(normalizedInventory)
  ].filter(value => typeof value === 'string'))];
  const candidateFiles = root && disposition === 'observed'
    ? scanWorkspaceFiles(root, { globs: candidatePatterns, paths: candidatePaths })
    : entries.map(doc => ({ path: doc.path, bytes: docBytes(doc) }));
  const changedPaths = new Set((Array.isArray(options.changedPaths) ? options.changedPaths : []).map(String));
  if (disposition === 'observed') {
    for (const relativePath of objectiveChangedPaths(baseFiles, candidateFiles, config, resolvedBaseConfig, resolvedBaseConfigSources, candidateConfigSources)) changedPaths.add(relativePath);
  }
  const frozenBaseInventory = immutableBasePrdInventory(
    normalizedInventory,
    resolvedBaseConfigSources,
    explicitBaseInventory
  );
  const additionalDiagnostics = [];
  if (disposition === 'observed') {
    const baseLegacyConfigSources = resolvedBaseConfigSources;
    additionalDiagnostics.push(...legacyHistoryDiagnostics(baseFiles, candidateFiles, candidateConfigSources, baseLegacyConfigSources));
    const candidateInventory = root
      ? candidateFiles.map(item => parseInventoryDoc(item.path, item.bytes)).filter(Boolean)
      : entries.map(doc => ({
        id: doc.frontmatter && doc.frontmatter.id,
        revision: doc.frontmatter && doc.frontmatter.revision,
        path: doc.path,
        status: doc.frontmatter && doc.frontmatter.status,
        bytes: docBytes(doc),
        frontmatter: doc.frontmatter,
        body: doc.body
      }));
    additionalDiagnostics.push(...immutabilityDiagnostics(frozenBaseInventory, candidateInventory));

    const transitionDocs = new Map(entries.map(doc => [doc.path, doc]));
    const explicitBaselinePaths = new Set(explicitBaseInventory ? normalizedInventory.map(item => item.path) : []);
    for (const file of candidateFiles) {
      const basePrd = explicitBaselinePaths.has(file.path) || governedPrdPath(file.path, resolvedBaseConfigSources);
      const currentPrd = roleAtPath(file.path, config) === 'prd' && !isLegacyPath(file.path, config);
      if (!basePrd && !currentPrd) continue;
      if (transitionDocs.has(file.path)) continue;
      const parsed = parseFrontmatter(Buffer.from(file.bytes).toString('utf8'));
      if (parsed.error || !parsed.data || typeof parsed.data.id !== 'string') continue;
      transitionDocs.set(file.path, {
        path: file.path,
        role: 'prd',
        legacy: false,
        frontmatter: parsed.data,
        body: parsed.body,
        error: parsed.error,
        workspace: root,
        storedBytes: Buffer.from(file.bytes)
      });
    }
    const transitionCandidates = [...transitionDocs.values()];
    additionalDiagnostics.push(...transitionDiagnostics(transitionCandidates, frozenBaseInventory, root));
    additionalDiagnostics.push(...migrationDiagnostics(entries, root, normalizedInventory, baseFiles, resolvedBaseConfigSources));
  }
  const preliminaryRetirementPrefix = options._retirementEligibleSources instanceof Set
    ? options._retirementEligibleSources
    : validatedEffectivePrefix(entries, graph, config, additionalDiagnostics);
  const preliminaryOptions = {
    ...options,
    changedPaths: [...changedPaths],
    _trustedBaseObserved: disposition === 'observed',
    _graph: graph,
    _retirementEligibleSources: preliminaryRetirementPrefix,
    _retirementValidationDiagnostics: additionalDiagnostics,
    _baseIdPaths: disposition === 'observed' ? baseIdPaths(normalizedInventory, config, resolvedBaseConfigSources) : undefined
  };
  // Namespace and REQ collisions are computed by lintDocs and do not depend on
  // retirement eligibility. Collect the complete authority findings once with
  // the preliminary prefix, then rebuild the prefix before emitting supersession
  // and conflict-resolution diagnostics.
  const preliminaryDiagnostics = lintDocs(entries, config, preliminaryOptions);
  const retirementEligibleSources = validatedEffectivePrefix(entries, graph, config, [
    ...additionalDiagnostics,
    ...preliminaryDiagnostics.filter(item => AUTHORITY_BLOCKER_DIAGNOSTICS.has(item.code))
  ]);
  const effectiveOptions = {
    ...preliminaryOptions,
    _retirementEligibleSources: retirementEligibleSources,
    _retirementValidationDiagnostics: [
      ...additionalDiagnostics,
      ...preliminaryDiagnostics.filter(item => AUTHORITY_BLOCKER_DIAGNOSTICS.has(item.code))
    ]
  };
  const diagnostics = lintDocs(entries, config, effectiveOptions);
  diagnostics.push(...additionalDiagnostics);
  const evidence = { immutability: disposition };
  if (explicitBaseInventory && !legacyClassificationObserved) evidence.legacyImmutability = 'not-observed';
  const result = { diagnostics: sortDiagnostics(diagnostics), evidence };
  Object.defineProperty(result, '_graph', { value: graph, enumerable: false });
  Object.defineProperty(result, '_retirementEligibleSources', { value: retirementEligibleSources, enumerable: false });
  return result;
}

function diffRevisions(docs, refA, refB) {
  const graph = revisionGraph(docs);
  const from = resolveRef(docs, refA, { graph });
  const to = resolveRef(docs, refB, { graph });
  if (!from.doc || !to.doc) return { error: 'unresolved-revision', from: from.error || null, to: to.error || null };
  const before = parseRequirementBlocks(from.doc);
  const after = parseRequirementBlocks(to.doc);
  const beforeById = new Map(before.map(item => [item.id, item]));
  const afterById = new Map(after.map(item => [item.id, item]));
  const beforeNames = new Map();
  for (const item of before) for (const name of [item.id, ...item.aliases]) {
    if (!beforeNames.has(name)) beforeNames.set(name, new Set());
    beforeNames.get(name).add(item.id);
  }
  const replaced = [];
  for (const item of after) for (const replacedName of item.replaces) {
    const targets = beforeNames.get(replacedName);
    if (targets && targets.size === 1) replaced.push({ from: [...targets][0], to: item.id });
  }
  replaced.sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
  const replacementSources = new Set(replaced.map(item => item.from));
  const kept = [];
  const changed = [];
  for (const [id, prior] of beforeById) {
    const next = afterById.get(id);
    if (!next) continue;
    if (prior.title === next.title && prior.block.trim() === next.block.trim()) kept.push(id);
    else changed.push({ id, reviewRequired: true });
  }
  const removed = [...beforeById.keys()].filter(id => !afterById.has(id) && !replacementSources.has(id)).sort(compareText);
  const added = [...afterById.keys()].filter(id => !beforeById.has(id) && !replaced.some(edge => edge.to === id)).sort(compareText);
  return {
    from: { id: from.doc.frontmatter.id, revision: from.doc.frontmatter.revision, path: from.doc.path, digest: from.digest },
    to: { id: to.doc.frontmatter.id, revision: to.doc.frontmatter.revision, path: to.doc.path, digest: to.digest },
    requirements: {
      kept: kept.sort(compareText),
      added,
      changed: changed.sort((a, b) => compareText(a.id, b.id)),
      removed,
      replaced
    }
  };
}

function documentId(doc) {
  return doc.legacy ? idFromLegacy(doc) : doc.frontmatter && typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : null;
}

function documentPin(doc) {
  if (isRevisionPrd(doc)) return `${doc.frontmatter.id}@r${doc.frontmatter.revision}`;
  return documentId(doc) || doc.path;
}

function effectiveRevisionHistory(group, parentByDoc) {
  const effective = group.filter(doc => doc.frontmatter.status === 'effective');
  if (!effective.length) return 'none';
  const effectiveSet = new Set(effective);
  const children = new Map();
  for (const doc of effective) {
    const parent = parentByDoc.get(doc);
    if (!effectiveSet.has(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(doc);
  }
  for (const values of children.values()) values.sort((a, b) => a.frontmatter.revision - b.frontmatter.revision || compareText(a.path, b.path));
  const roots = effective.filter(doc => doc.frontmatter.previous_revision === undefined
    || doc.frontmatter.previous_revision === null || doc.frontmatter.previous_revision === '');
  const paths = [];
  const visited = new Set();
  const walk = (doc, chain, visiting) => {
    if (visiting.has(doc)) return;
    visiting.add(doc);
    visited.add(doc);
    const next = children.get(doc) || [];
    if (!next.length) paths.push([...chain, documentPin(doc)]);
    else for (const child of next) walk(child, [...chain, documentPin(doc)], visiting);
    visiting.delete(doc);
  };
  for (const root of roots) walk(root, [], new Set());
  for (const doc of effective) if (!visited.has(doc)) paths.push([`unlinked: ${documentPin(doc)}`]);
  return paths.map(chain => chain.join(' -> ')).join('; ') || 'none';
}

function buildIndex(docs, config, options = {}) {
  const entries = Array.isArray(docs) ? docs : [];
  const mode = options.all === true
    ? { all: true }
    : { changedPaths: Array.isArray(options.changedPaths) ? options.changedPaths : [] };
  const analysis = Array.isArray(options.diagnostics)
    ? null
    : analyzeDocs(entries, config, { ...options, ...mode });
  const graph = options._graph || analysis && analysis._graph || revisionGraph(entries);
  const validatedPrefix = options._retirementEligibleSources instanceof Set
    ? options._retirementEligibleSources
    : analysis
      ? analysis._retirementEligibleSources
      : validatedEffectivePrefix(entries, graph, config, options._retirementValidationDiagnostics || options.diagnostics);
  let diagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : analysis.diagnostics;
  const indexAuthorityDiagnostics = [
    ...(Array.isArray(options._retirementValidationDiagnostics) ? options._retirementValidationDiagnostics : []),
    ...diagnostics.filter(item => item && item.severity === 'error')
  ].filter(item => item && item.severity === 'error');
  const indexAuthorityPrefix = validatedEffectivePrefix(entries, graph, config, indexAuthorityDiagnostics, {
    includeGraphDiagnostics: false
  });
  diagnostics = diagnostics.filter(item => RESOLUTION_DIAGNOSTICS.has(item.code));
  const edges = [];
  for (const doc of entries) {
    if (doc.legacy || doc.error || !doc.frontmatter) continue;
    for (const ref of asList(doc.frontmatter.supersedes)) {
      if (typeof ref !== 'string') continue;
      const result = resolveRef(entries, ref, { graph });
      if (result.doc) {
        const eligibility = supersessionEligibility(doc, result.doc, ref, validatedPrefix, graph);
        edges.push({ source: doc, target: result.doc, ref, ...eligibility });
      }
    }
  }
  const incoming = new Map();
  for (const edge of edges.filter(item => item.effective)) {
    if (!incoming.has(edge.target.path)) incoming.set(edge.target.path, []);
    incoming.get(edge.target.path).push(edge.source);
  }
  const sortDocs = (left, right) => compareText(documentId(left) || '', documentId(right) || '') || compareText(left.path, right.path);
  const active = entries.filter(doc => !doc.legacy).slice().sort(sortDocs);
  const legacy = entries.filter(doc => doc.legacy).slice().sort(sortDocs);
  const lines = ['# Document lifecycle index', '', '## Active documents', ''];
  if (!active.length) lines.push('_None._', '');
  for (const doc of active) {
    const data = doc.frontmatter || {};
    const id = documentId(doc) || '(no id)';
    const details = [`role: ${doc.role || 'unassigned'}`];
    if (isRevisionPrd(doc)) {
      const logicalId = graph.logicalIdByDoc.get(doc);
      const current = graph.currentById.get(logicalId);
      const valid = graph.structurallyValid.get(logicalId) !== false;
      const currentAuthorityInvalid = current === doc && !indexAuthorityPrefix.has(current);
      const derivedState = !valid || currentAuthorityInvalid ? 'invalid' : current === doc ? 'current' : current ? (data.status === 'effective' ? 'historical' : 'pending') : 'pre-activation';
      details.push(`stored status: ${data.status || '(missing)'}`, `derived state: ${derivedState}`);
    } else {
      details.push(`status: ${data.status || '(missing)'}`);
      if (isPrdCompatibility(doc)) details.push('pre-D6.9 compatibility: migration required; not current authority');
    }
    const aliases = Array.isArray(data.aliases) ? data.aliases.filter(item => typeof item === 'string').slice().sort(compareText) : [];
    if (aliases.length) details.push(`aliases: ${aliases.map(item => `\`${item}\``).join(', ')}`);
    const successors = (incoming.get(doc.path) || []).slice().sort(sortDocs);
    if (successors.length) {
      const provenance = successors.map(source => {
        const edge = edges.find(item => item.effective && item.source.path === source.path && item.target.path === doc.path);
        return edge && edge.retirement ? `\`${documentPin(source)}\` -> \`${documentPin(doc)}\`` : `\`${documentId(source) || source.path}\``;
      });
      details.push(`superseded by: ${provenance.join(', ')}`);
      const retirementEdges = successors.map(source => edges.find(item => item.effective && item.retirement && item.source.path === source.path && item.target.path === doc.path)).filter(Boolean);
      if (retirementEdges.length) details.push(`retirement provenance: ${retirementEdges.map(edge => `\`${documentPin(edge.source)}\` -> \`${documentPin(edge.target)}\``).sort(compareText).join(', ')}`);
    }
    const outgoing = edges.filter(edge => edge.source.path === doc.path);
    const pending = outgoing.filter(edge => !edge.effective);
    if (pending.length) details.push(`pending supersedes: ${pending.map(edge => `\`${edge.ref}\``).sort(compareText).join(', ')}`);
    const retirements = outgoing.filter(edge => edge.retirement);
    if (retirements.length) details.push(`retires: ${retirements.map(edge => `\`${edge.ref}\``).sort(compareText).join(', ')}`);
    lines.push(`- \`${id}\` — \`${doc.path}\` (${details.join('; ')})`);
  }
  lines.push('', '## PRD revision chains', '');
  if (!graph.groups.size) lines.push('_None._', '');
  for (const [logicalId, group] of [...graph.groups.entries()].sort((a, b) => compareText(a[0], b[0]))) {
    const revisions = group.slice().sort((a, b) => a.frontmatter.revision - b.frontmatter.revision || compareText(a.path, b.path));
    const current = graph.currentById.get(logicalId);
    const valid = graph.structurallyValid.get(logicalId) !== false;
    const currentAuthorityInvalid = Boolean(current && !indexAuthorityPrefix.has(current));
    const state = !valid || currentAuthorityInvalid ? 'invalid' : current ? 'valid' : 'pre-activation';
    const currentText = current && !currentAuthorityInvalid
      ? `\`${documentPin(current)}\` (\`${current.path}\`; digest: \`${graph.artifactDigests.get(current) || artifactDigest(current)}\`)`
      : 'none';
    const history = effectiveRevisionHistory(revisions, graph.parentByDoc).replace(/(PRD-[A-Z][A-Z0-9]{1,9}-\d{3,}@r[1-9]\d*)/g, '`$1`');
    const pending = revisions.filter(doc => ['draft', 'approved'].includes(doc.frontmatter.status));
    const pendingText = pending.length
      ? pending.map(doc => `\`${documentPin(doc)}\` (${doc.frontmatter.status})`).join(', ')
      : 'none';
    lines.push(`- \`${logicalId}\` — state: ${state}; current: ${currentText}; history: ${history}; pending: ${pendingText}`);
  }
  lines.push('', '## Legacy documents', '');
  if (!legacy.length) lines.push('_None._', '');
  for (const doc of legacy) {
    const id = documentId(doc) || '(no id)';
    const stored = doc.frontmatter && doc.frontmatter.status || '(missing)';
    const successors = (incoming.get(doc.path) || []).slice().sort(sortDocs);
    const projected = successors.length
      ? `superseded (projected) by ${successors.map(item => `\`${documentId(item) || item.path}\``).join(', ')}`
      : `same as stored status ${stored}`;
    lines.push(`- \`${id}\` — \`${doc.path}\` (stored status: ${stored}; effective status: ${projected}${successors.length ? `; source edge: ${successors.map(item => `\`${item.path}\``).join(', ')}` : ''})`);
  }
  lines.push('', '## Unresolved', '');
  if (!diagnostics.length) lines.push('_None._', '');
  for (const item of diagnostics) lines.push(`- \`${item.code}\` (${item.severity}) — \`${item.path}\`: ${item.message}`);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = { command, changedProvided: false, changedPaths: [], all: false };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--all') options.all = true;
    else if (arg === '--changed-path') {
      if (index + 1 >= rest.length) throw new Error(`${arg} requires a value`);
      const value = rest[++index];
      if (!value.trim()) throw new Error(`${arg} requires a non-empty path`);
      options.changedProvided = true;
      options.changedPaths.push(value);
    }
    else if (arg === '--workspace' || arg === '--config' || arg === '--changed' || arg === '--base') {
      if (index + 1 >= rest.length) throw new Error(`${arg} requires a value`);
      const value = rest[++index];
      if (arg === '--workspace') options.workspace = value;
      if (arg === '--config') options.configFile = value;
      if (arg === '--changed') { options.changedProvided = true; options.changedPaths = options.changedPaths.concat(value.split(',').map(item => item.trim()).filter(Boolean)); }
      if (arg === '--base') options.base = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['lint', 'index'].includes(command)) throw new Error('usage: doc-lifecycle.js <lint|index> --workspace <dir> --config <json-file, relative to --workspace> [--changed a,b | --changed-path <path> | --all] [--base <git-rev>]');
  if (!options.workspace || !options.configFile) throw new Error('--workspace and --config are required');
  if (!options.changedProvided && !options.all) throw new Error('lint and index require --changed or --all');
  if (options.all && options.changedProvided) throw new Error('choose either --changed or --all');
  return options;
}

function normalizeChangedPath(workspacePath, value) {
  const input = String(value).trim().replace(/\\/g, '/');
  if (!input) throw new Error('--changed entries must name files within --workspace');
  if (path.sep !== '\\' && /^[A-Za-z]:\//.test(input)) {
    throw new Error(`--changed path is outside --workspace: ${value}`);
  }
  const absolute = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspacePath, input);
  const relative = path.relative(workspacePath, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`--changed path is outside --workspace or does not name a file: ${value}`);
  }
  return relative.split(path.sep).join('/');
}

function validateExplicitConfig(config, configPath) {
  let validateDocsConfig;
  try {
    ({ validateDocsConfig } = require('./project-docs-resolver'));
  } catch (error) {
    throw new Error(`cannot load shared project-docs validator for ${configPath}: ${error.message}`);
  }
  if (typeof validateDocsConfig !== 'function') {
    throw new Error(`shared project-docs validator for ${configPath} does not export validateDocsConfig`);
  }
  const result = validateDocsConfig(config);
  if (!result.valid) {
    const details = result.diagnostics.map(item => `${item.code}: ${item.message}`).join('; ');
    throw new Error(`invalid project-docs config at ${configPath}: ${details}`);
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseCli(argv); } catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  const workspacePath = path.resolve(options.workspace);
  if (options.changedProvided) {
    try { options.changedPaths = options.changedPaths.map(item => normalizeChangedPath(workspacePath, item)); } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  const configPath = path.isAbsolute(options.configFile)
    ? path.resolve(options.configFile)
    : path.resolve(workspacePath, options.configFile);
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) {
    process.stderr.write(`cannot read config: ${error.message}\n`);
    return 2;
  }
  try { validateExplicitConfig(config, configPath); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const docs = collectDocs(workspacePath, config);
  const mode = {
    ...(options.all ? { all: true } : { changedPaths: options.changedPaths }),
    workspace: workspacePath, base: options.base, configPath,
    configSources: readWorkspaceConfigSources(workspacePath, configPath, config)
  };
  const analysis = analyzeDocs(docs, config, mode);
  if (options.command === 'index') {
    process.stdout.write(buildIndex(docs, config, {
      ...mode,
      diagnostics: analysis.diagnostics,
      _graph: analysis._graph,
      _retirementEligibleSources: analysis._retirementEligibleSources
    }));
    return 0;
  }
  process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
  return analysis.diagnostics.some(item => item.severity === 'error') ? 1 : 0;
}

module.exports = { parseFrontmatter, collectDocs, analyzeDocs, resolveRef, lintDocs, buildIndex, diffRevisions };

if (require.main === module) process.exitCode = main();
