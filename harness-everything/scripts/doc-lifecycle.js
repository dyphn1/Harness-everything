#!/usr/bin/env node
'use strict';

// Pure project-document lifecycle helpers. This module intentionally does not
// load a host resolver or execute configured derived-document generators.
const fs = require('fs');
const path = require('path');

const ROLE_STATUSES = Object.freeze({
  prd: new Set(['draft', 'active', 'superseded']),
  adr: new Set(['proposed', 'accepted', 'rejected', 'superseded']),
  ticket: new Set(['open', 'blocked', 'done', 'withdrawn']),
  reference: new Set(['active', 'deprecated']),
  log: new Set(['final', 'archived']),
  report: new Set(['final', 'archived'])
});
const ADR_ID = /^([A-Z][A-Z0-9]{1,9})-(\d{3,})$/;
const REQ_ID = /^REQ-([A-Z][A-Z0-9]{1,9})-(\d{3,})$/;
const ANY_ID = /^(?:REQ-)?[A-Z][A-Z0-9]{1,9}-\d{3,}$/;
const RESOLUTION_DIAGNOSTICS = new Set([
  'malformed-frontmatter', 'missing-id', 'invalid-id', 'unknown-domain',
  'duplicate-id', 'alias-collision', 'duplicate-req', 'missing-req',
  'unresolved-ref', 'ambiguous-legacy-ref', 'invalid-ref', 'invalid-alias',
  'missing-status', 'invalid-status', 'role-mismatch',
  'supersede-status-mismatch', 'supersede-cycle', 'recorded-conflict'
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

function collectDocs(root, config) {
  const workspace = path.resolve(root);
  const governed = Array.isArray(config && config.governed) ? config.governed : [];
  const legacyGlobs = Array.isArray(config && config.legacy) ? config.legacy : [];
  const files = [];
  function walk(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  walk(workspace);

  const docs = [];
  for (const absolute of files) {
    const relativePath = path.relative(workspace, absolute).split(path.sep).join('/');
    const roleEntry = governed.find(entry => entry && typeof entry.path === 'string' && matchesAny(relativePath, [entry.path]));
    const legacy = matchesAny(relativePath, legacyGlobs);
    if (!roleEntry && !legacy) continue;
    let text;
    try { text = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
    const parsed = parseFrontmatter(text);
    docs.push({
      path: relativePath,
      role: roleEntry ? roleEntry.role : null,
      legacy,
      frontmatter: parsed.data,
      body: parsed.body,
      error: parsed.error
    });
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

function reqDeclarations(docs) {
  const declarations = [];
  for (const doc of docs || []) {
    if (doc.legacy || doc.role !== 'prd' || !doc.frontmatter || doc.frontmatter.status !== 'active') continue;
    const body = withoutFencedCode(doc.body || '');
    for (const line of body.split(/\r?\n/)) {
      const heading = line.match(/^#{1,6}[ \t]+(REQ-[A-Z][A-Z0-9]{1,9}-\d{3,})(?:[ \t]+\(aliases:[ \t]*([^)]*)\))?(?::|[ \t]|$)/);
      if (!heading) continue;
      const aliases = heading[2] === undefined ? [] : heading[2].split(',').map(item => item.trim());
      declarations.push({ id: heading[1], aliases, doc });
    }
  }
  return declarations;
}

function activeDeclarations(docs) {
  const result = [];
  for (const doc of docs || []) {
    if (doc.legacy || !doc.frontmatter) continue;
    const id = doc.frontmatter.id;
    if (typeof id === 'string' && id) result.push({ id, aliases: Array.isArray(doc.frontmatter.aliases) ? doc.frontmatter.aliases : [], doc, kind: 'document' });
  }
  for (const req of reqDeclarations(docs || [])) result.push({ ...req, kind: 'requirement' });
  return result;
}

function resolveRef(docs, ref) {
  if (typeof ref !== 'string' || !ref.trim()) return { error: 'unresolved-ref', candidates: [] };
  const value = ref.trim();
  const allDocs = Array.isArray(docs) ? docs : [];
  if (value.startsWith('legacy:')) {
    const selector = value.slice('legacy:'.length);
    const at = selector.indexOf('@');
    const id = at < 0 ? selector : selector.slice(0, at);
    const archivePath = at < 0 ? null : selector.slice(at + 1);
    if (!ANY_ID.test(id) || (archivePath !== null && !validLegacySelectorPath(archivePath))) {
      return { error: 'invalid-ref', candidates: [] };
    }
    let candidates = allDocs.filter(doc => doc.legacy && idFromLegacy(doc) === id);
    if (archivePath !== null) candidates = candidates.filter(doc => doc.path === archivePath);
    candidates.sort((a, b) => compareText(a.path, b.path));
    if (candidates.length === 1) return { doc: candidates[0] };
    if (candidates.length > 1) return { error: 'ambiguous-legacy-ref', candidates };
    return { error: 'unresolved-ref', candidates: [] };
  }

  const matches = [];
  for (const declaration of activeDeclarations(allDocs)) {
    if (declaration.id === value || declaration.aliases.includes(value)) matches.push(declaration.doc);
  }
  const uniqueMatches = [...new Map(matches.map(doc => [doc.path, doc])).values()]
    .sort((a, b) => compareText(a.path, b.path));
  if (uniqueMatches.length === 1) return { doc: uniqueMatches[0] };
  if (uniqueMatches.length > 1) return { error: 'unresolved-ref', candidates: uniqueMatches };
  const legacyMatches = allDocs.filter(doc => doc.legacy && idFromLegacy(doc) === value)
    .sort((a, b) => compareText(a.path, b.path));
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

  for (const doc of governed) {
    if (!changed(doc)) continue;
    if (doc.error) {
      diagnostics.push(makeDiagnostic('malformed-frontmatter', 'error', doc, `frontmatter cannot be parsed: ${doc.error}`));
      continue;
    }
    const data = doc.frontmatter || {};
    if (data.role !== undefined && data.role !== doc.role) {
      diagnostics.push(makeDiagnostic('role-mismatch', 'error', doc, `frontmatter role ${String(data.role)} does not match path role ${String(doc.role)}`));
    }
    const statusSet = ROLE_STATUSES[doc.role];
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
          if (typeof alias !== 'string' || alias.startsWith('legacy:') || !ANY_ID.test(alias) || alias === data.id) {
            diagnostics.push(makeDiagnostic('invalid-alias', 'error', doc, `invalid document alias ${String(alias)}`, typeof alias === 'string' ? alias : undefined));
          }
        }
      }
    }
  }

  // Canonical document IDs occupy one active namespace; legacy IDs do not.
  const idGroups = new Map();
  for (const doc of governed) {
    const id = doc.frontmatter && doc.frontmatter.id;
    if (typeof id !== 'string' || !id || doc.error) continue;
    if (!idGroups.has(id)) idGroups.set(id, []);
    idGroups.get(id).push(doc);
  }
  for (const [id, group] of idGroups) {
    if (group.length < 2) continue;
    const severity = crossSeverity(group);
    const paths = [...new Set(group.map(item => item.path))].sort(compareText);
    for (const doc of group.slice().sort((a, b) => compareText(a.path, b.path))) {
      const candidates = paths.filter(candidate => candidate !== doc.path);
      diagnostics.push(makeDiagnostic('duplicate-id', severity, doc, `canonical ID ${id} is also used by ${candidates.join(', ')}`, id, candidates));
    }
  }

  const reqs = reqDeclarations(entries);
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
  for (const doc of governed) {
    if (!doc.frontmatter || doc.error) continue;
    addClaim(doc.frontmatter.id, doc, 'document', true);
    for (const alias of asList(doc.frontmatter.aliases)) if (typeof alias === 'string') addClaim(alias, doc, 'document', false);
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
    // Ratchet involvement: an explicit archive selector names its target path,
    // so a changed (deleted/renamed) target path escalates this diagnostic even
    // when the declaring document is unchanged. ID-only refs name no path; we
    // keep no per-ref baseline data, so we do not claim deletion coverage for
    // them and keep declaring-doc-only involvement.
    const involved = [source];
    if (typeof ref === 'string' && ref.startsWith('legacy:')) {
      const at = ref.indexOf('@');
      if (at >= 0) {
        const archivePath = ref.slice(at + 1);
        if (validLegacySelectorPath(archivePath)) involved.push({ path: archivePath });
      }
    }
    diagnostics.push(makeDiagnostic(code || result.error || 'unresolved-ref', crossSeverity(involved), source, detail, ref, candidates));
  }

  for (const doc of governed) {
    if (doc.error || !doc.frontmatter) continue;
    const supersedes = asList(doc.frontmatter.supersedes);
    for (const ref of supersedes) {
      if (typeof ref !== 'string') { unresolved('unresolved-ref', doc, ref, { candidates: [] }, 'supersedes entries must be string references'); continue; }
      const result = resolveRef(entries, ref);
      if (!result.doc) { unresolved(result.error, doc, ref, result); continue; }
      const target = result.doc;
      const edge = { source: doc, target, ref, effective: (doc.role === 'adr' && doc.frontmatter.status === 'accepted') || (doc.role === 'prd' && doc.frontmatter.status === 'active') };
      edges.push(edge);
      if (target.path === doc.path) {
        diagnostics.push(makeDiagnostic('supersede-cycle', crossSeverity([doc]), doc, `${doc.path} supersedes itself`, doc.frontmatter.id));
      } else if (edge.effective && !target.legacy && (!target.frontmatter || target.frontmatter.status !== 'superseded')) {
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
  const referencePattern = /(?:^|[^A-Za-z0-9_-])((?:legacy:)?(?:REQ-[A-Z][A-Z0-9]{1,9}-\d{3,}|[A-Z][A-Z0-9]{1,9}-\d{3,})(?:@[^\s`<>()\[\]{}]+)?)/g;
  for (const doc of governed) {
    if (doc.error) continue;
    const body = withoutFencedCode(doc.body || '');
    const seen = new Set();
    for (const match of body.matchAll(referencePattern)) {
      const ref = match[1].replace(/[.,;:!?]+$/, '');
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (ref.startsWith('REQ-') && !allReqIds.has(ref)) {
        diagnostics.push(makeDiagnostic('missing-req', crossSeverity([doc]), doc, `requirement ${ref} is referenced but is not defined in an active PRD`, ref));
        continue;
      }
      const result = resolveRef(entries, ref);
      // A duplicate canonical ID or alias already has a structural diagnostic;
      // avoid adding a second unresolved-reference finding for prose that names
      // that conflicted identity.
      if (result.error === 'unresolved-ref' && result.candidates && result.candidates.length > 1 && result.candidates.some(candidate => !candidate.legacy)) continue;
      if (!result.doc) unresolved(result.error, doc, ref, result);
    }
  }

  // Conflicts are owner-recorded; only an eligible supersession between the
  // pair resolves them. The declaration is kept on the document that records it.
  const effectivePairs = new Set(edges.filter(edge => edge.effective).map(edge => `${edge.source.path}\0${edge.target.path}`));
  for (const doc of governed) {
    if (doc.error || !doc.frontmatter) continue;
    for (const ref of asList(doc.frontmatter.conflicts_with)) {
      const result = resolveRef(entries, ref);
      if (!result.doc) { unresolved(result.error, doc, ref, result); continue; }
      const target = result.doc;
      if (target.path === doc.path || effectivePairs.has(`${doc.path}\0${target.path}`) || effectivePairs.has(`${target.path}\0${doc.path}`)) continue;
      diagnostics.push(makeDiagnostic('recorded-conflict', crossSeverity([doc, target]), doc, `recorded conflict between ${doc.frontmatter.id || doc.path} and ${target.frontmatter && target.frontmatter.id || target.path}`, ref, [target.path]));
    }
  }

  return sortDiagnostics(diagnostics);
}

function documentId(doc) {
  return doc.legacy ? idFromLegacy(doc) : doc.frontmatter && typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : null;
}

function buildIndex(docs, config, options = {}) {
  const entries = Array.isArray(docs) ? docs : [];
  let diagnostics;
  if (Array.isArray(options.diagnostics)) {
    diagnostics = options.diagnostics;
  } else {
    const mode = options.all === true
      ? { all: true }
      : { changedPaths: Array.isArray(options.changedPaths) ? options.changedPaths : [] };
    diagnostics = lintDocs(entries, config, mode);
  }
  diagnostics = diagnostics.filter(item => RESOLUTION_DIAGNOSTICS.has(item.code));
  const edges = [];
  for (const doc of entries) {
    if (doc.legacy || doc.error || !doc.frontmatter) continue;
    const effective = (doc.role === 'adr' && doc.frontmatter.status === 'accepted') || (doc.role === 'prd' && doc.frontmatter.status === 'active');
    for (const ref of asList(doc.frontmatter.supersedes)) {
      if (typeof ref !== 'string') continue;
      const result = resolveRef(entries, ref);
      if (result.doc) edges.push({ source: doc, target: result.doc, ref, effective });
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
    const details = [`role: ${doc.role || 'unassigned'}`, `status: ${data.status || '(missing)'}`];
    const aliases = Array.isArray(data.aliases) ? data.aliases.filter(item => typeof item === 'string').slice().sort(compareText) : [];
    if (aliases.length) details.push(`aliases: ${aliases.map(item => `\`${item}\``).join(', ')}`);
    const successors = (incoming.get(doc.path) || []).slice().sort(sortDocs);
    if (successors.length) details.push(`superseded by: ${successors.map(item => `\`${documentId(item) || item.path}\``).join(', ')}`);
    const outgoing = edges.filter(edge => edge.source.path === doc.path);
    const pending = outgoing.filter(edge => !edge.effective);
    if (pending.length) details.push(`pending supersedes: ${pending.map(edge => `\`${edge.ref}\``).sort(compareText).join(', ')}`);
    lines.push(`- \`${id}\` — \`${doc.path}\` (${details.join('; ')})`);
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
  const options = { command, changedProvided: false, all: false };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--all') options.all = true;
    else if (arg === '--workspace' || arg === '--config' || arg === '--changed') {
      if (index + 1 >= rest.length) throw new Error(`${arg} requires a value`);
      const value = rest[++index];
      if (arg === '--workspace') options.workspace = value;
      if (arg === '--config') options.configFile = value;
      if (arg === '--changed') { options.changedProvided = true; options.changedPaths = value.split(',').map(item => item.trim()).filter(Boolean); }
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['lint', 'index'].includes(command)) throw new Error('usage: doc-lifecycle.js <lint|index> --workspace <dir> --config <json-file> [--changed a,b | --all]');
  if (!options.workspace || !options.configFile) throw new Error('--workspace and --config are required');
  if (!options.changedProvided && !options.all) throw new Error('lint and index require --changed or --all');
  if (options.all && options.changedProvided) throw new Error('choose either --changed or --all');
  return options;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseCli(argv); } catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  let config;
  try { config = JSON.parse(fs.readFileSync(path.resolve(options.configFile), 'utf8')); } catch (error) {
    process.stderr.write(`cannot read config: ${error.message}\n`);
    return 2;
  }
  const docs = collectDocs(path.resolve(options.workspace), config);
  const mode = options.all ? { all: true } : { changedPaths: options.changedPaths };
  if (options.command === 'index') {
    process.stdout.write(buildIndex(docs, config, mode));
    return 0;
  }
  const diagnostics = lintDocs(docs, config, options.all ? { all: true } : { changedPaths: options.changedPaths });
  process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
  return diagnostics.some(item => item.severity === 'error') ? 1 : 0;
}

module.exports = { parseFrontmatter, collectDocs, resolveRef, lintDocs, buildIndex };

if (require.main === module) process.exitCode = main();
