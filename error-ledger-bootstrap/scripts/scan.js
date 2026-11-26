#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USAGE = 'usage: node scan.js --root <repo> [--out <dir>] [--no-memory] [--memory <path>]... [--instructions <path>]... [--tracker <file.json>]... [--source local-store --destination harness|project] [--hide-ledger] [--home <dir>] [--json]';
const HASH = /^[0-9a-f]{40}$/i;
const SOURCE_STATUSES = new Set(['used', 'missing', 'disabled', 'unverified', 'unavailable']);
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const LEDGER_INDEX_MAX_BYTES = 512 * 1024;
const LOCAL_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROVISIONAL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RECORD_ID = /^E-\d{4,}$/;

function failure(message, exitCode = 2) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function parseArgs(args) {
  const options = { memory: [], instructions: [], tracker: [], noMemory: false, hideLedger: false, json: false };
  const seen = new Set();
  const values = new Set(['--root', '--out', '--home', '--memory', '--instructions', '--tracker', '--source', '--destination']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-memory' || arg === '--hide-ledger' || arg === '--json') {
      if (seen.has(arg)) failure(`duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === '--no-memory') options.noMemory = true;
      if (arg === '--hide-ledger') options.hideLedger = true;
      if (arg === '--json') options.json = true;
      continue;
    }
    if (!values.has(arg)) failure(`unknown option: ${arg}`);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) failure(`missing value for ${arg}`);
    const value = args[++i];
    if (arg === '--memory' || arg === '--instructions' || arg === '--tracker') {
      options[arg.slice(2)].push(value);
      continue;
    }
    if (seen.has(arg)) failure(`duplicate option: ${arg}`);
    seen.add(arg);
    options[arg.slice(2)] = value;
  }
  if (!options.root) failure(`--root is required; ${USAGE}`);
  if (options.source !== undefined && options.source !== 'local-store') failure(`unknown source: ${options.source}`);
  if (options.source === 'local-store' && !options.destination) failure('--destination is required for --source local-store');
  if (options.destination !== undefined && options.source !== 'local-store') failure('--destination requires --source local-store');
  if (options.destination !== undefined && !['harness', 'project'].includes(options.destination)) {
    failure(`invalid --destination: ${options.destination}`);
  }
  return options;
}

function git(root, args, encoding = 'utf8', exitCode = 1) {
  try {
    return childProcess.execFileSync('git', ['-C', root, ...args], {
      encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GIT_MAX_BUFFER
    });
  } catch (cause) {
    if (cause.code === 'ENOBUFS') {
      failure(`git ${args[0] || 'command'} output exceeded the configured limit of ${GIT_MAX_BUFFER} bytes for the target repository`, exitCode);
    }
    failure(`git ${args[0] || 'command'} failed for the target repository`, exitCode);
  }
}

function canonical(file) {
  return fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file);
}

function isWithin(root, candidate, pathApi) {
  const api = pathApi || (process.platform === 'win32' ? path.win32 : path);
  const windows = api === path.win32 || (!pathApi && process.platform === 'win32');
  const comparisonRoot = windows ? root.toLowerCase() : root;
  const comparisonCandidate = windows ? candidate.toLowerCase() : candidate;
  const relative = api.relative(comparisonRoot, comparisonCandidate);
  return relative === '' || (!api.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${api.sep}`));
}

function resolveWithSymlinks(candidate) {
  let current = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      fs.lstatSync(current);
      return path.join(canonical(current), ...suffix);
    } catch (cause) {
      if (cause.code !== 'ENOENT' && cause.code !== 'ENOTDIR') throw cause;
      const parent = path.dirname(current);
      if (parent === current) throw cause;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isLedgerPath(relative) {
  const rel = relative.replace(/\\/g, '/').replace(/^\.\//, '');
  return rel === '.agents/harness-everything/errors' ||
    rel.startsWith('.agents/harness-everything/errors/') ||
    rel === 'docs/error-handling' || rel.startsWith('docs/error-handling/');
}

function isDocumentationPath(relative) {
  return relative.toLowerCase().endsWith('.md') || relative.startsWith('docs/');
}

function normalizedRepoPath(relative) {
  return relative.replace(/\\/g, '/').replace(/^\.\//, '');
}

function parseHistory(root, hideLedger) {
  const tokens = git(root, ['log', '-z', '--name-status', '--format=%H%x00%s']).split('\0');
  const groups = new Map();
  for (let i = 0; i < tokens.length;) {
    const sha = tokens[i++];
    if (!sha) continue;
    if (!HASH.test(sha) || i >= tokens.length) failure('git history returned an invalid record', 1);
    const subject = tokens[i++];
    const relevant = /^(?:fix(?:\([^\r\n)]*\))?!?:\s|revert(?:\([^\r\n)]*\))?!?:\s|Revert ".+"$)/.test(subject);
    const changed = new Set();
    while (i < tokens.length && !HASH.test(tokens[i])) {
      const status = tokens[i++].replace(/^\r?\n/, '');
      if (!status) continue;
      if (!/^[ACDMRTUXB]\d*$/.test(status)) failure('git history returned an invalid file status', 1);
      const count = /^[RC]/.test(status) ? 2 : 1;
      for (let n = 0; n < count; n++) {
        if (i >= tokens.length) failure('git history returned an incomplete file record', 1);
        const site = normalizedRepoPath(tokens[i++]);
        if (!hideLedger || !isLedgerPath(site)) changed.add(site);
      }
    }
    if (relevant) {
      for (const site of changed) {
        const type = isDocumentationPath(site) ? 'doc' : 'git';
        const key = `${type}\0${site}`;
        const commits = groups.get(key) || new Map();
        commits.set(sha, { sha, subject });
        groups.set(key, commits);
      }
    }
  }
  return [...groups.entries()]
    .filter(([, commits]) => commits.size >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, commits]) => {
      const [type, site] = key.split('\0');
      return makeCandidate({
        title: `Repeated fix history for ${site}`,
        signature: `repeated-fix:${site}`,
        sites: [site],
        sources: [...commits.values()].sort((a, b) => a.sha.localeCompare(b.sha)).map(commit => type === 'doc'
          ? { type, path: site, sha: commit.sha }
          : { type, sha: commit.sha, subject: commit.subject })
      });
    });
}

function repoFiles(root) {
  return git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean).map(normalizedRepoPath);
}

function isTrackedRegularFile(root, site) {
  if (!site || site === '.' || site.endsWith('/') || path.posix.isAbsolute(site) ||
      /^[A-Za-z]:/.test(site) || site.includes('\\') || site.split('/').includes('..')) {
    return false;
  }
  const candidate = path.resolve(root, site.split('/').join(path.sep));
  if (!isWithin(root, candidate)) return false;
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (_) {
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  let resolved;
  try {
    resolved = canonical(candidate);
  } catch (_) {
    return false;
  }
  if (!isWithin(root, resolved)) return false;
  try {
    return fs.statSync(resolved).isFile();
  } catch (_) {
    return false;
  }
}

function trackedRegularFiles(root) {
  const entries = git(root, ['ls-files', '--cached', '--stage', '-z']).split('\0').filter(Boolean);
  const tracked = new Set();
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const mode = entry.slice(0, entry.indexOf(' '));
    if (mode !== '100644' && mode !== '100755') continue;
    const site = normalizedRepoPath(entry.slice(tab + 1));
    if (isTrackedRegularFile(root, site)) tracked.add(site);
  }
  return tracked;
}

function safeRead(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

function walkMarkdown(directory) {
  const found = [];
  function visit(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(file);
    }
  }
  visit(directory);
  return found;
}

function isMemoryIndex(file) {
  return /^memory\.md$/i.test(path.basename(file));
}

function isRegularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return !stat.isSymbolicLink() && stat.isFile();
  } catch (_) {
    return false;
  }
}

function flatMarkdown(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !isMemoryIndex(entry.name))
      .map(entry => path.join(directory, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch (_) {
    return [];
  }
}

function explicitFiles(input, root, hideLedger) {
  const absolute = path.resolve(input);
  let stat;
  try { stat = fs.statSync(absolute); } catch (_) { return []; }
  const files = stat.isDirectory() ? walkMarkdown(absolute) : stat.isFile() ? [absolute] : [];
  return files.filter(file => {
    if (!hideLedger) return true;
    let resolved;
    try { resolved = resolveWithSymlinks(file); } catch (_) { resolved = file; }
    return !isWithin(root, resolved) || !isLedgerPath(normalizedRepoPath(path.relative(root, resolved)));
  });
}

function localSourceId(file) {
  return `local/${crypto.createHash('sha256').update(path.resolve(file)).digest('hex')}`;
}

function labelPath(file, root) {
  const resolved = path.resolve(file);
  if (isWithin(root, resolved)) return `repo/${normalizedRepoPath(path.relative(root, resolved)) || '.'}`;
  return localSourceId(resolved);
}

function markdownTitle(text) {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (frontmatter) {
    const title = /^title:\s*(.+?)\s*$/m.exec(frontmatter[1]);
    if (title) return title[1].replace(/^['"]|['"]$/g, '');
  }
  const section = /^#{1,6}\s*(?:cue|lesson)\s*\r?\n+([\s\S]*?)(?=\r?\n#{1,6}\s|$)/im.exec(text);
  if (section) return section[1].trim().split(/\r?\n/).find(Boolean) || '';
  const heading = /^#\s+(.+)$/m.exec(text);
  return heading ? heading[1].trim() : '';
}

function lessonSites(text, knownFiles) {
  const sites = new Set();
  const expression = /(?<![A-Za-z0-9_.:/\\])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+)\b/g;
  for (const match of text.matchAll(expression)) {
    const site = path.posix.normalize(match[1]);
    if (!path.posix.isAbsolute(site) && !site.split('/').includes('..') && !/^[A-Za-z]:/.test(site) &&
      (!knownFiles || knownFiles.has(site))) sites.add(site);
  }
  return [...sites].sort();
}

const MEMORY_WRAPPER_PAIRS = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['|', '|']
];

function isForbiddenMemoryToken(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /^file:\//i.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('./') ||
    /^[A-Za-z]:/.test(value) ||
    value.includes('\\') ||
    /(?:^|\/)\.\.(?:\/|$)/.test(value);
}

function stripMemoryPunctuation(value) {
  return value.replace(/[,;:!?]+$/, '').replace(/\.$/, '');
}

function resolveMemorySiteToken(token, trackedFiles) {
  let current = token;
  while (current) {
    if (isForbiddenMemoryToken(current)) return null;
    if (trackedFiles.has(current)) return current;

    const depunct = stripMemoryPunctuation(current);
    if (depunct !== current) {
      current = depunct;
      continue;
    }

    const linkSep = current.indexOf('](');
    if (linkSep !== -1 && current.endsWith(')')) {
      return resolveMemorySiteToken(current.slice(linkSep + 2, -1), trackedFiles);
    }

    let peeled = false;
    for (const [open, close] of MEMORY_WRAPPER_PAIRS) {
      if (current.length >= 2 && current.startsWith(open) && current.endsWith(close)) {
        current = current.slice(1, -1);
        peeled = true;
        break;
      }
    }
    if (peeled) continue;

    if (/^["'`<>(\[{|]/.test(current)) {
      current = current.slice(1);
      continue;
    }
    if (/["'`<>)\]}|]$/.test(current)) {
      current = current.slice(0, -1);
      continue;
    }
    break;
  }
  return null;
}

function memorySites(text, trackedFiles) {
  if (!trackedFiles || !trackedFiles.size) return [];
  const sites = new Set();
  for (const raw of String(text || '').split(/\s+/)) {
    if (!raw) continue;
    const site = resolveMemorySiteToken(raw, trackedFiles);
    if (site) sites.add(site);
  }
  return [...sites].sort();
}

function consumeQuotedScalar(lines, lineIdx, startCol) {
  const quote = lines[lineIdx][startCol];
  let value = '';
  for (let li = lineIdx; li < lines.length; li++) {
    const line = lines[li];
    let col = li === lineIdx ? startCol + 1 : 0;
    while (col < line.length) {
      const ch = line[col];
      if (quote === '"' && ch === '\\') {
        if (col + 1 >= line.length) {
          col += 1;
          break;
        }
        const next = line[col + 1];
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
        col += 2;
        continue;
      }
      if (quote === "'" && ch === "'" && line[col + 1] === "'") {
        value += "'";
        col += 2;
        continue;
      }
      if (ch === quote) {
        const trailing = line.slice(col + 1);
        if (!/^(?:[ \t]+#.*|[ \t]*)$/.test(trailing)) return { ok: false };
        return { ok: true, value, endLine: li, multiline: li !== lineIdx };
      }
      value += ch;
      col += 1;
    }
    if (li < lines.length - 1) value += '\n';
  }
  return { ok: false };
}

function parseTypeScalar(rawValue) {
  const trimmed = rawValue.trimStart();
  if (!trimmed || trimmed.startsWith('#')) return { ok: false };
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    const quoted = consumeQuotedScalar([trimmed], 0, 0);
    if (!quoted.ok || quoted.multiline || !quoted.value.trim()) return { ok: false };
    return { ok: true, value: quoted.value };
  }
  if (/^[[\]{}|>&*!]/.test(trimmed)) return { ok: false };
  const commentIdx = trimmed.search(/[ \t]+#/);
  const plain = (commentIdx === -1 ? trimmed : trimmed.slice(0, commentIdx)).trimEnd();
  if (!plain || plain === 'null' || plain === '~' || /^[?:,-](?:[ \t]|$)|:[ \t]/.test(plain)) {
    return { ok: false };
  }
  return { ok: true, value: plain };
}

function parseMappingLine(content) {
  if (content[0] === '"' || content[0] === "'") {
    const quote = content[0];
    let key = '';
    let col = 1;
    while (col < content.length) {
      const ch = content[col];
      if (quote === '"' && ch === '\\') {
        if (col + 1 >= content.length) return null;
        key += content[col + 1];
        col += 2;
        continue;
      }
      if (quote === "'" && ch === "'" && content[col + 1] === "'") {
        key += "'";
        col += 2;
        continue;
      }
      if (ch === quote) {
        const rest = /^([ \t]*):(?:([ \t]+.*)|[ \t]*)$/.exec(content.slice(col + 1));
        if (!rest) return null;
        return { key, rawValue: rest[2] || '' };
      }
      key += ch;
      col += 1;
    }
    return null;
  }
  const match = /^([^:#\[\]{}"'\t-][^:\t]*?)[ \t]*:(?:([ \t]+.*)|[ \t]*)$/.exec(content);
  if (!match) return null;
  return { key: match[1].trim(), rawValue: match[2] || '' };
}

function consumeOtherValue(lines, lineIdx, keyIndent, rawValue) {
  const trimmed = rawValue.trimStart();
  if (!trimmed || trimmed.startsWith('#')) {
    return { ok: true, endLine: lineIdx, allowsNested: true };
  }
  if (/^[|>](?:[+-]?\d*|\d*[+-]?)?(?:[ \t]+#.*|[ \t]*)$/.test(trimmed)) {
    let end = lineIdx;
    for (let j = lineIdx + 1; j < lines.length; j++) {
      if (/^[ \t]*$/.test(lines[j])) {
        end = j;
        continue;
      }
      const spaces = /^ */.exec(lines[j])[0].length;
      if (spaces > keyIndent) {
        end = j;
        continue;
      }
      break;
    }
    return { ok: true, endLine: end, allowsNested: false };
  }
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    const startCol = lines[lineIdx].length - trimmed.length;
    const quoted = consumeQuotedScalar(lines, lineIdx, startCol);
    if (!quoted.ok) return { ok: false };
    return { ok: true, endLine: quoted.endLine, allowsNested: false };
  }
  return { ok: true, endLine: lineIdx, allowsNested: false };
}

function consumeNestedLine(lines, lineIdx, indent, content) {
  const parsed = parseMappingLine(content);
  if (!parsed) return { ok: true, endLine: lineIdx };
  const consumed = consumeOtherValue(lines, lineIdx, indent, parsed.rawValue);
  if (!consumed.ok) return { ok: false };
  return { ok: true, endLine: consumed.endLine };
}

function parseMemoryFrontmatter(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  if (!/^---[ \t]*$/.test(lines[0])) {
    return { state: 'untyped', body: source };
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return { state: 'malformed', body: '' };

  const fmLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n');
  const topTypes = [];
  const metaTypes = [];
  let inMetadata = false;
  let metaChildIndent = null;
  let topAllowsNested = false;
  let metaChildAllowsNested = false;
  let metaCount = 0;

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (/^[ \t]*(?:#.*)?$/.test(line)) continue;
    const indentMatch = /^([ \t]*)/.exec(line);
    if (indentMatch[1].includes('\t')) return { state: 'malformed', body };
    const indent = indentMatch[1].length;
    const content = line.slice(indent);

    if (inMetadata) {
      if (indent === 0) {
        inMetadata = false;
        metaChildIndent = null;
        metaChildAllowsNested = false;
      } else {
        if (metaChildIndent === null) {
          if (/^-(?:[ \t]|$)/.test(content)) return { state: 'malformed', body };
          metaChildIndent = indent;
        }
        if (indent < metaChildIndent) return { state: 'malformed', body };
        if (indent > metaChildIndent) {
          if (!metaChildAllowsNested) return { state: 'malformed', body };
          const nested = consumeNestedLine(fmLines, i, indent, content);
          if (!nested.ok) return { state: 'malformed', body };
          i = nested.endLine;
          continue;
        }
        if (metaChildAllowsNested && /^-(?:[ \t]|$)/.test(content)) continue;
        metaChildAllowsNested = false;
        const entry = parseMappingLine(content);
        if (!entry) return { state: 'malformed', body };
        if (entry.key === 'type') {
          const scalar = parseTypeScalar(entry.rawValue);
          if (!scalar.ok) return { state: 'malformed', body };
          metaTypes.push(scalar.value.toLowerCase());
        } else {
          const consumed = consumeOtherValue(fmLines, i, indent, entry.rawValue);
          if (!consumed.ok) return { state: 'malformed', body };
          i = consumed.endLine;
          metaChildAllowsNested = consumed.allowsNested;
        }
        continue;
      }
    }

    if (indent > 0) {
      if (!topAllowsNested) return { state: 'malformed', body };
      const nested = consumeNestedLine(fmLines, i, indent, content);
      if (!nested.ok) return { state: 'malformed', body };
      i = nested.endLine;
      continue;
    }
    if (topAllowsNested && /^-(?:[ \t]|$)/.test(content)) continue;
    topAllowsNested = false;
    const entry = parseMappingLine(content);
    if (!entry) return { state: 'malformed', body };
    if (entry.key === 'type') {
      const scalar = parseTypeScalar(entry.rawValue);
      if (!scalar.ok) return { state: 'malformed', body };
      topTypes.push(scalar.value.toLowerCase());
    } else if (entry.key === 'metadata') {
      const trimmed = entry.rawValue.trimStart();
      if (trimmed && !trimmed.startsWith('#')) return { state: 'malformed', body };
      metaCount += 1;
      if (metaCount > 1) return { state: 'malformed', body };
      inMetadata = true;
      metaChildIndent = null;
      metaChildAllowsNested = false;
    } else {
      const consumed = consumeOtherValue(fmLines, i, 0, entry.rawValue);
      if (!consumed.ok) return { state: 'malformed', body };
      i = consumed.endLine;
      topAllowsNested = consumed.allowsNested;
    }
  }

  if (topTypes.length > 1 || metaTypes.length > 1) {
    return { state: 'malformed', body };
  }
  if (topTypes.length === 1 && metaTypes.length === 1) {
    if (topTypes[0] !== metaTypes[0]) return { state: 'conflicting', body };
    return { state: topTypes[0] === 'feedback' ? 'feedback' : 'explicit-other', body };
  }
  const single = topTypes[0] ?? metaTypes[0];
  if (single !== undefined) {
    return { state: single === 'feedback' ? 'feedback' : 'explicit-other', body };
  }
  return { state: 'untyped', body };
}

function stripFencedCodeBlocks(text) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  let fenceChar = null;
  let fenceLen = 0;
  for (const line of lines) {
    if (!fenceChar) {
      const open = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open && (open[1][0] === '~' || !open[2].includes('`'))) {
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        continue;
      }
      kept.push(line);
    } else {
      const close = new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`);
      if (close.test(line)) {
        fenceChar = null;
        fenceLen = 0;
      }
    }
  }
  return kept.join('\n');
}

function hasPairedWhyHowHeadings(body) {
  const why = /^[ \t]{0,3}(?:#{1,6}[ \t]*why(?:\s*:|\s*$)|(?:\*\*why:\*\*|\*\*why\*\*:|__why:__|__why__:)(?:[ \t]|$)|(?:\*\*why\*\*|__why__)[ \t]*$)/im;
  const how = /^[ \t]{0,3}(?:#{1,6}[ \t]*how[ \t]+to[ \t]+apply(?:\s*:|\s*$)|(?:\*\*how[ \t]+to[ \t]+apply:\*\*|\*\*how[ \t]+to[ \t]+apply\*\*:|__how[ \t]+to[ \t]+apply:__|__how[ \t]+to[ \t]+apply__:)(?:[ \t]|$)|(?:\*\*how[ \t]+to[ \t]+apply\*\*|__how[ \t]+to[ \t]+apply__)[ \t]*$)/im;
  return why.test(body) && how.test(body);
}

function isInstructionLesson(text, file) {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const feedback = frontmatter && /^type:\s*['"]?feedback(?:['"]?\s|$)/mi.test(frontmatter[1]);
  return Boolean(feedback || /^lesson-/i.test(path.basename(file)) || /^#{1,6}\s*(?:cue|lesson)\b/im.test(text));
}

function isMemoryLesson(text, file) {
  if (isMemoryIndex(file)) return false;
  const parsed = parseMemoryFrontmatter(text);
  if (parsed.state === 'feedback') return true;
  if (parsed.state !== 'untyped') return false;
  if (/^(?:lesson|feedback)-/i.test(path.basename(file))) return true;
  const cleanBody = stripFencedCodeBlocks(parsed.body);
  if (/^[ \t]{0,3}#{1,6}[ \t]*(?:cue|lesson)\b/im.test(cleanBody)) return true;
  return hasPairedWhyHowHeadings(cleanBody);
}

function isLesson(text, file, type = 'instruction') {
  return type === 'memory' ? isMemoryLesson(text, file) : isInstructionLesson(text, file);
}

function publicText(value, root, home) {
  let text = String(value || '');
  for (const [absolute, label] of [[root, '<repo>'], [home, '<home>']]) {
    if (absolute) text = text.split(absolute).join(label);
  }
  return text
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, '[path]')
    .replace(/(?<![A-Za-z0-9])\/(?:[^/\s"'`<>]+\/)*[^/\s"'`<>]+/g, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

function shortTitle(value, root, home) {
  return publicText(value, root, home).slice(0, 120) || 'Unverified lesson';
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'lesson';
}

function makeCandidate({ title, signature, sites, sources }) {
  const sortedSites = [...new Set(sites)].sort();
  const sortedSources = [...sources].sort((a, b) => `${a.type}:${a.sha || a.ref}`.localeCompare(`${b.type}:${b.sha || b.ref}`));
  const identity = JSON.stringify(['error-candidate', sortedSites, sortedSources.map(source => `${source.type}:${source.sha || source.ref}`)]);
  return {
    id: crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20),
    kind: 'error-candidate',
    domain: sortedSites.length ? sortedSites[0].split('/')[0] : 'unknown',
    title,
    signature,
    sites: sortedSites,
    sources: sortedSources,
    attachments: [],
    status: 'UNVERIFIED'
  };
}

function candidatesFromFiles(files, type, root, home, knownFiles, privateInput = false) {
  const candidates = [];
  for (const file of files) {
    if (type === 'memory' && isMemoryIndex(file)) continue;
    const text = safeRead(file);
    if (text === null || !isLesson(text, file, type)) continue;
    const privateSource = type === 'memory' || privateInput || !isWithin(root, path.resolve(file));
    const title = privateSource ? `Local ${type} lead` :
      shortTitle(markdownTitle(text) || path.basename(file, path.extname(file)), root, home);
    const ref = privateSource ? localSourceId(file) : labelPath(file, root);
    candidates.push(makeCandidate({
      title,
      signature: slug(title),
      sites: type === 'memory'
        ? memorySites(text, knownFiles)
        : lessonSites(text, privateSource ? knownFiles : undefined),
      sources: [{ type, ref }]
    }));
  }
  return candidates;
}

function samePath(left, right, pathApi) {
  return isWithin(left, right, pathApi) && isWithin(right, left, pathApi);
}

function parseWorktreeList(raw) {
  const entries = [];
  let current = null;
  for (const token of raw.split('\0')) {
    if (token === '') {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (token.startsWith('worktree ')) {
      if (current) entries.push(current);
      try {
        current = { root: canonical(token.slice(9)), bare: false };
      } catch (_) {
        current = null;
      }
    } else if (current && token === 'bare') {
      current.bare = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function mainWorktreeRoot(root) {
  let commonRaw;
  let gitDirRaw;
  try {
    commonRaw = git(root, ['rev-parse', '--git-common-dir']).trim();
    gitDirRaw = git(root, ['rev-parse', '--git-dir']).trim();
  } catch (_) {
    return null;
  }
  if (!commonRaw || !gitDirRaw) return null;
  let commonDir;
  let gitDir;
  try {
    commonDir = canonical(path.resolve(root, commonRaw));
    gitDir = canonical(path.resolve(root, gitDirRaw));
  } catch (_) {
    return null;
  }
  if (samePath(commonDir, gitDir)) return null;
  if (path.basename(commonDir) !== '.git') return null;
  const candidate = path.dirname(commonDir);
  let mainRoot;
  try {
    if (!fs.statSync(candidate).isDirectory()) return null;
    mainRoot = canonical(candidate);
  } catch (_) {
    return null;
  }
  if (samePath(mainRoot, root)) return null;
  let worktreeRaw;
  try {
    worktreeRaw = git(root, ['worktree', 'list', '--porcelain', '-z']);
  } catch (_) {
    return null;
  }
  const registered = parseWorktreeList(worktreeRaw);
  const mainEntry = registered.find(entry => !entry.bare && samePath(entry.root, mainRoot));
  if (!mainEntry) return null;
  try {
    const mainTop = canonical(git(mainRoot, ['rev-parse', '--show-toplevel']).trim());
    const mainGitDir = canonical(path.resolve(mainRoot, git(mainRoot, ['rev-parse', '--git-dir']).trim()));
    const mainCommonDir = canonical(path.resolve(mainRoot, git(mainRoot, ['rev-parse', '--git-common-dir']).trim()));
    if (!samePath(mainTop, mainRoot) || !samePath(mainGitDir, commonDir) || !samePath(mainCommonDir, commonDir)) {
      return null;
    }
  } catch (_) {
    return null;
  }
  return mainRoot;
}

function inspectMemorySlug(targetRoot, home) {
  const slugDir = path.join(home, '.claude', 'projects', path.resolve(targetRoot).replace(/[^a-z0-9]/gi, '-'));
  const directory = path.join(slugDir, 'memory');
  const files = flatMarkdown(directory);
  let reason = fs.existsSync(directory) ? 'hinted memory directory contains no Markdown files' : 'hinted memory directory is missing';
  const currentMarker = path.join(directory, 'MEMORY.md');
  const legacyMarker = path.join(slugDir, 'MEMORY.md');
  const marker = isRegularFile(currentMarker) ? currentMarker : isRegularFile(legacyMarker) ? legacyMarker : null;
  let verified = Boolean(marker);
  let verificationRef = marker || undefined;
  if (verified) reason = 'automatic memory marker found';
  else if (files.length) {
    for (const file of files) {
      const text = safeRead(file) || '';
      if (text.includes(path.basename(targetRoot)) || text.includes(targetRoot)) {
        verified = true;
        verificationRef = file;
        reason = 'a memory file names the target repository';
        break;
      }
    }
    if (!verified) reason = 'automatic memory marker absent and no memory file names the target repository';
  }
  return { directory, files, verified, reason, verificationRef };
}

function autoMemory(root, home) {
  const primary = inspectMemorySlug(root, home);
  if (primary.verified) return primary;
  const mainRoot = mainWorktreeRoot(root);
  if (!mainRoot) return primary;
  const fallback = inspectMemorySlug(mainRoot, home);
  if (fallback.verified || (!primary.files.length && fallback.files.length)) {
    return fallback;
  }
  return primary;
}

function sourceStatus(type, origin, status, details = {}) {
  return { type, origin, status, ...details };
}

function trackerSites(body, root, files) {
  const text = typeof body === 'string' ? body : '';
  return files.filter(file => {
    if (!fs.existsSync(path.join(root, file))) return false;
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_./-])(?:\\.\\/)?${escaped}(?![A-Za-z0-9_./-])`).test(text);
  });
}

function collectTracker(options, root, home, files) {
  const candidates = [];
  if (!options.tracker.length) {
    return {
      sources: [sourceStatus('tracker', 'offline', 'missing', { reason: 'no --tracker file provided' })],
      candidates
    };
  }

  const sources = [];
  for (const input of options.tracker) {
    const file = path.resolve(input);
    let issues;
    try {
      issues = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      failure('cannot read tracker export as JSON', 2);
    }
    if (!Array.isArray(issues)) failure('tracker export must be a JSON array', 2);
    sources.push(sourceStatus('tracker', 'offline', 'used', { ref: labelPath(file, root) }));
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) failure('tracker export contains an invalid issue', 2);
      const title = typeof issue.title === 'string' ? issue.title : '';
      const labels = Array.isArray(issue.labels) ? issue.labels : [];
      const qualifies = labels.some(label => /^(?:bug|regression|flake)$/i.test(String(label && label.name || ''))) ||
        /^\s*(?:fix|bug)\b/i.test(title);
      if (!qualifies) continue;
      if (!Number.isSafeInteger(issue.number) || issue.number < 1 || !title.trim()) {
        failure('tracker issue is missing a valid number or title', 2);
      }
      const ref = `#${issue.number}`;
      const candidateTitle = shortTitle(title, root, home);
      candidates.push(makeCandidate({
        title: candidateTitle,
        signature: slug(candidateTitle),
        sites: trackerSites(issue.body, root, files),
        sources: [{ type: 'tracker', ref }]
      }));
    }
  }
  return { sources, candidates };
}

function collectSources(options, root, home, files, historyCandidates) {
  const documentation = historyCandidates.some(item => item.sources.some(source => source.type === 'doc'));
  const knownFiles = new Set(files);
  const tracker = collectTracker(options, root, home, files);
  const sources = [
    sourceStatus('git', 'history', 'used'),
    sourceStatus('doc', 'history', documentation ? 'used' : 'missing',
      documentation ? {} : { reason: 'no repeated Markdown or docs paths found' }),
    ...tracker.sources
  ];
  const candidates = [...tracker.candidates];
  if (options.noMemory) {
    sources.push(sourceStatus('memory', 'auto', 'disabled', { verified: false, reason: 'disabled by --no-memory' }));
    sources.push(sourceStatus('instruction', 'repository', 'disabled', { reason: 'disabled by --no-memory' }));
    sources.push(sourceStatus('instruction', 'global-explicit', 'disabled', { reason: 'disabled by --no-memory' }));
    for (const input of options.memory) sources.push(sourceStatus('memory', 'explicit', 'disabled', { ref: localSourceId(input), reason: 'disabled by --no-memory' }));
    for (const input of options.instructions) sources.push(sourceStatus('instruction', 'global-explicit', 'disabled', { ref: localSourceId(input), reason: 'disabled by --no-memory' }));
    return { sources, candidates };
  }

  const trackedMemoryFiles = trackedRegularFiles(root);
  const auto = autoMemory(root, home);
  sources.push(sourceStatus('memory', 'auto', auto.files.length ? (auto.verified ? 'used' : 'unverified') : 'missing', {
    verified: auto.verified, reason: auto.reason,
    ref: localSourceId(auto.directory),
    ...(auto.verificationRef ? { verificationRef: localSourceId(auto.verificationRef) } : {})
  }));
  if (auto.verified) candidates.push(...candidatesFromFiles(auto.files, 'memory', root, home, trackedMemoryFiles));

  if (options.memory.length) {
    for (const input of options.memory) {
      const selected = explicitFiles(input, root, options.hideLedger);
      sources.push(sourceStatus('memory', 'explicit', selected.length ? 'used' : 'missing', {
        ref: localSourceId(input),
        ...(selected.length ? {} : { reason: 'no readable files at the selected path' })
      }));
      candidates.push(...candidatesFromFiles(selected, 'memory', root, home, trackedMemoryFiles));
    }
  } else {
    sources.push(sourceStatus('memory', 'explicit', 'missing', { reason: 'no --memory path provided' }));
  }

  const instructionFiles = files.filter(file => ['AGENTS.md', 'CLAUDE.md'].includes(path.posix.basename(file)) &&
    (!options.hideLedger || !isLedgerPath(file)));
  sources.push(sourceStatus('instruction', 'repository', instructionFiles.length ? 'used' : 'missing', {
    ...(instructionFiles.length ? { refs: instructionFiles } : { reason: 'no repository AGENTS.md or CLAUDE.md files found' })
  }));
  candidates.push(...candidatesFromFiles(instructionFiles.map(file => path.join(root, file)), 'instruction', root, home, knownFiles));

  if (options.instructions.length) {
    for (const input of options.instructions) {
      const selected = explicitFiles(input, root, options.hideLedger);
      sources.push(sourceStatus('instruction', 'global-explicit', selected.length ? 'used' : 'missing', {
        ref: localSourceId(input),
        ...(selected.length ? {} : { reason: 'no readable files at the selected path' })
      }));
      candidates.push(...candidatesFromFiles(selected, 'instruction', root, home, knownFiles, true));
    }
  } else {
    sources.push(sourceStatus('instruction', 'global-explicit', 'disabled', { reason: 'global instructions require --instructions' }));
  }
  return { sources, candidates };
}

function localStoreRef(workspaceKey, provisionalId) {
  const key = JSON.stringify([workspaceKey, provisionalId]);
  return `p-local-${crypto.createHash('sha256').update(key).digest('hex')}`;
}

function workspaceRef(workspaceKey) {
  return `w-local-${crypto.createHash('sha256').update(workspaceKey).digest('hex')}`;
}

function validLocalRecord(record, workspaceKey, store) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      record.schemaVersion !== store.SCHEMA_VERSION ||
      !['occurrence', 'provisional-lesson'].includes(record.kind) ||
      record.workspaceKey !== workspaceKey ||
      typeof record.provisionalId !== 'string' || !PROVISIONAL_ID.test(record.provisionalId) || /^E-/i.test(record.provisionalId) ||
      !store.DESTINATIONS.includes(record.destination) ||
      typeof record.signature !== 'string' || !LOCAL_IDENTIFIER.test(record.signature) ||
      typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) return false;
  if (record.kind === 'occurrence') {
    return record.source === 'tool-failure' && ['claude', 'codex', 'opencode', 'unknown'].includes(record.host) &&
      store.COMMAND_CLASSES.includes(record.commandClass) &&
      (record.exitCode === null || Number.isSafeInteger(record.exitCode)) &&
      (record.sessionKey === null || /^[a-f0-9]{24}$/.test(record.sessionKey)) &&
      (record.toolUseId === null || /^[a-f0-9]{24}$/.test(record.toolUseId)) &&
      typeof record.outputExcerpt === 'string' && Buffer.byteLength(record.outputExcerpt, 'utf8') <= store.LIMITS.maxExcerptBytes &&
      Array.isArray(record.matchedLedgerIds) && record.matchedLedgerIds.length <= store.LIMITS.maxMatchedLedgerIds &&
      record.matchedLedgerIds.every(id => typeof id === 'string' && (RECORD_ID.test(id) || LOCAL_IDENTIFIER.test(id)));
  }
  try {
    store.validateMatch(record.match);
  } catch (_) { return false; }
  return typeof record.lesson === 'string' && record.lesson.trim().length > 0 &&
    Buffer.byteLength(record.lesson, 'utf8') <= store.LIMITS.maxLessonChars &&
    (record.cue === undefined || (typeof record.cue === 'string' && Buffer.byteLength(record.cue, 'utf8') <= store.LIMITS.maxCueChars)) &&
    (record.issueUrl === null || typeof record.issueUrl === 'string') &&
    (record.promotionId === null || (typeof record.promotionId === 'string' && RECORD_ID.test(record.promotionId)));
}

function validLocalStoreReader(store) {
  try {
    if (!store || typeof store !== 'object' || Array.isArray(store)) return false;
    const destinations = store.DESTINATIONS;
    const commandClasses = store.COMMAND_CLASSES;
    const limits = store.LIMITS;
    const validEnum = (values, required) => Array.isArray(values) &&
      required.every(value => values.includes(value)) &&
      values.every((value, index) => typeof value === 'string' && value.length > 0 && values.indexOf(value) === index);
    return Number.isSafeInteger(store.SCHEMA_VERSION) && store.SCHEMA_VERSION > 0 &&
      typeof store.INDEX_FILE === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(store.INDEX_FILE) &&
      typeof store.INDEX_KIND === 'string' && store.INDEX_KIND.length > 0 &&
      validEnum(destinations, ['harness', 'project', 'unknown']) &&
      validEnum(commandClasses, ['git', 'gh', 'test', 'build', 'package', 'shell']) &&
      limits !== null && typeof limits === 'object' && !Array.isArray(limits) &&
      ['maxIndexBytes', 'maxExcerptBytes', 'maxMatchedLedgerIds', 'maxLessonChars', 'maxCueChars']
        .every(name => Number.isSafeInteger(limits[name]) && limits[name] > 0) &&
      ['getStorePath', 'resolveWorkspaceKey', 'listRecords', 'validateMatch']
        .every(name => typeof store[name] === 'function');
  } catch (_) { return false; }
}

function inspectLocalStore(file, store) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (cause) {
    return cause.code === 'ENOENT'
      ? { status: 'missing', reason: 'index-missing' }
      : { status: 'unverified', reason: 'store-unreadable' };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { status: 'unverified', reason: 'store-unreadable' };
  if (stat.size > store.LIMITS.maxIndexBytes) return { status: 'unverified', reason: 'store-corrupt' };
  let envelope;
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.length > store.LIMITS.maxIndexBytes) return { status: 'unverified', reason: 'store-corrupt' };
    envelope = JSON.parse(bytes.toString('utf8'));
  } catch (_) { return { status: 'unverified', reason: 'store-corrupt' }; }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Array.isArray(envelope.records)) {
    return { status: 'unverified', reason: 'store-corrupt' };
  }
  if (envelope.schemaVersion !== store.SCHEMA_VERSION || envelope.kind !== store.INDEX_KIND) {
    return { status: 'unverified', reason: 'store-unsupported' };
  }
  return { status: 'used', rowCount: envelope.records.length };
}

function inspectDestinationLedger(root, store) {
  const errors = path.join(root, '.agents', 'harness-everything', 'errors');
  let errorsStat;
  try { errorsStat = fs.lstatSync(errors); }
  catch (cause) {
    return cause.code === 'ENOENT'
      ? { status: 'unverified', reason: 'ledger-missing', rows: [] }
      : { status: 'unverified', reason: 'ledger-unreadable', rows: [] };
  }
  if (errorsStat.isSymbolicLink() || !errorsStat.isDirectory()) return { status: 'unverified', reason: 'ledger-unreadable', rows: [] };
  let realErrors;
  try { realErrors = canonical(errors); }
  catch (_) { return { status: 'unverified', reason: 'ledger-unreadable', rows: [] }; }
  if (!isWithin(root, realErrors)) return { status: 'unverified', reason: 'ledger-unreadable', rows: [] };

  const file = path.join(realErrors, 'index.jsonl');
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (cause) {
    return cause.code === 'ENOENT'
      ? { status: 'unverified', reason: 'ledger-missing', rows: [] }
      : { status: 'unverified', reason: 'ledger-unreadable', rows: [] };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { status: 'unverified', reason: 'ledger-unreadable', rows: [] };
  if (stat.size > LEDGER_INDEX_MAX_BYTES) return { status: 'unverified', reason: 'ledger-corrupt', rows: [] };

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > LEDGER_INDEX_MAX_BYTES) return { status: 'unverified', reason: 'ledger-corrupt', rows: [] };
  } catch (_) { return { status: 'unverified', reason: 'ledger-unreadable', rows: [] }; }

  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > 512 || lines.some(line => !line.trim())) return { status: 'unverified', reason: 'ledger-corrupt', rows: [] };
  const rows = [];
  const ids = new Set();
  try {
    for (const line of lines) {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          typeof row.id !== 'string' || !RECORD_ID.test(row.id) || ids.has(row.id) ||
          typeof row.signature !== 'string' || !LOCAL_IDENTIFIER.test(row.signature) ||
          typeof row.file !== 'string' || !new RegExp(`^\\.agents/harness-everything/errors/${row.id}-[a-z0-9-]+\\.md$`).test(row.file)) {
        throw new Error('invalid index row');
      }
      let match = null;
      if (Object.hasOwn(row, 'match')) {
        match = store.validateMatch(row.match);
        if (typeof row.matchBinding !== 'string' || !/^[a-f0-9]{64}$/.test(row.matchBinding)) throw new Error('invalid match binding');
      } else if (Object.hasOwn(row, 'matchBinding')) throw new Error('invalid match binding');
      ids.add(row.id);
      rows.push({ id: row.id, signature: row.signature, match });
    }
  } catch (_) { return { status: 'unverified', reason: 'ledger-corrupt', rows: [] }; }
  return { status: 'verified', rows };
}

function canonicalMatch(match, store) {
  const validated = store.validateMatch(match);
  const normalized = {};
  for (const phase of ['actions', 'failures']) {
    if (!validated[phase]) continue;
    normalized[phase] = validated[phase].map(rule => ({
      ...rule,
      ...(rule.diagnostics ? { diagnostics: [...rule.diagnostics].sort() } : {})
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return JSON.stringify(normalized);
}

function destinationDedupe(signature, match, ledger, store) {
  if (ledger.status !== 'verified') {
    return { status: 'unverified', classIds: [], matchedBy: [], newClassEligible: false };
  }
  const matches = new Map();
  const localMatch = match ? canonicalMatch(match, store) : null;
  for (const row of ledger.rows) {
    const methods = [];
    if (row.signature === signature) methods.push('signature');
    if (localMatch && row.match && canonicalMatch(row.match, store) === localMatch) methods.push('whole-rule');
    if (methods.length) matches.set(row.id, new Set([...(matches.get(row.id) || []), ...methods]));
  }
  const classIds = [...matches.keys()].sort();
  const matchedBy = [...new Set([...matches.values()].flatMap(methods => [...methods]))].sort();
  return {
    status: classIds.length > 1 ? 'ambiguous' : classIds.length === 1 ? 'existing' : 'none',
    classIds,
    matchedBy,
    newClassEligible: classIds.length === 0
  };
}

function localCandidate(title, signature, records, match, ledger, store, destination) {
  const candidate = makeCandidate({
    title,
    signature,
    sites: [],
    sources: records.map(record => ({
      type: 'local-store',
      kind: record.kind,
      ref: localStoreRef(record.workspaceKey, record.provisionalId),
      destination,
      signature: record.signature,
      ...(record.kind === 'occurrence' ? { commandClass: record.commandClass } : {})
    }))
  });
  candidate.local = {
    evidenceReadiness: 'needs-evidence',
    occurrenceCount: records.filter(record => record.kind === 'occurrence').length,
    dedupe: destinationDedupe(signature, match, ledger, store)
  };
  return candidate;
}

function collectLocalStore(options, root) {
  const fallbackWorkspaceRef = workspaceRef(root);
  const emptyCounts = { workspaceRecords: 0, lessons: 0, occurrences: 0, candidates: 0, destinationMismatch: 0, unknownDestination: 0, malformed: 0, suppressedOccurrences: 0 };
  let store;
  try { store = require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib', 'local-errors.js')); }
  catch (_) {
    const ledger = { status: 'unverified', reason: 'ledger-not-checked' };
    return {
      source: sourceStatus('local-store', 'workspace', 'unavailable', {
        reason: 'reader-unavailable', workspaceRef: fallbackWorkspaceRef, destination: options.destination,
        ledgerStatus: ledger.status, ledgerReason: ledger.reason,
        counts: { workspaceRecords: 0, lessons: 0, occurrences: 0, candidates: 0, destinationMismatch: 0, unknownDestination: 0, malformed: 0, suppressedOccurrences: 0 }
      }),
      candidates: []
    };
  }
  if (!validLocalStoreReader(store)) {
    return {
      source: sourceStatus('local-store', 'workspace', 'unavailable', {
        reason: 'reader-contract-incomplete', workspaceRef: fallbackWorkspaceRef, destination: options.destination,
        ledgerStatus: 'unverified', ledgerReason: 'ledger-not-checked', counts: emptyCounts
      }),
      candidates: []
    };
  }

  let workspaceKey;
  try { workspaceKey = store.resolveWorkspaceKey({ workspaceRoot: root }); }
  catch (_) {
    return {
      source: sourceStatus('local-store', 'workspace', 'unverified', {
        reason: 'workspace-unavailable', workspaceRef: fallbackWorkspaceRef, destination: options.destination,
        ledgerStatus: 'unverified', ledgerReason: 'ledger-not-checked',
        counts: emptyCounts
      }),
      candidates: []
    };
  }
  const ref = workspaceRef(workspaceKey);
  const hostBinding = ['HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR']
    .some(name => typeof process.env[name] === 'string' && process.env[name].trim());
  if (hostBinding) {
    let hostKey;
    try { hostKey = store.resolveWorkspaceKey({}, { env: process.env }); }
    catch (_) {
      return {
        source: sourceStatus('local-store', 'workspace', 'unverified', {
          reason: 'workspace-binding-unavailable', workspaceRef: ref, destination: options.destination,
          ledgerStatus: 'unverified', ledgerReason: 'ledger-not-checked',
          counts: emptyCounts
        }),
        candidates: []
      };
    }
    if (hostKey !== workspaceKey) {
      return {
        source: sourceStatus('local-store', 'workspace', 'unverified', {
          reason: 'workspace-binding-mismatch', workspaceRef: ref, destination: options.destination,
          ledgerStatus: 'unverified', ledgerReason: 'ledger-not-checked',
          counts: emptyCounts
        }),
        candidates: []
      };
    }
  }

  let storePath;
  try { storePath = store.getStorePath().file; }
  catch (_) {
    return {
      source: sourceStatus('local-store', 'workspace', 'unverified', {
        reason: 'store-unreadable', workspaceRef: ref, destination: options.destination,
        ledgerStatus: 'unverified', ledgerReason: 'ledger-not-checked',
        counts: emptyCounts
      }),
      candidates: []
    };
  }
  const diagnostic = inspectLocalStore(storePath, store);
  const ledger = inspectDestinationLedger(root, store);
  if (diagnostic.status !== 'used') {
    return {
      source: sourceStatus('local-store', 'workspace', diagnostic.status, {
        reason: diagnostic.reason, workspaceRef: ref, destination: options.destination,
        ledgerStatus: ledger.status, ...(ledger.reason ? { ledgerReason: ledger.reason } : {}), counts: emptyCounts
      }),
      candidates: []
    };
  }

  let records;
  try {
    records = store.listRecords({ workspaceRoot: root, workspaceKey });
  } catch (_) {
    return {
      source: sourceStatus('local-store', 'workspace', 'unverified', {
        reason: 'reader-failed', workspaceRef: ref, destination: options.destination,
        ledgerStatus: ledger.status, ...(ledger.reason ? { ledgerReason: ledger.reason } : {}), counts: emptyCounts
      }),
      candidates: []
    };
  }
  const scoped = Array.isArray(records) ? records.filter(record => record && record.workspaceKey === workspaceKey) : [];
  let malformed = Array.isArray(records) ? 0 : 1;
  const valid = [];
  const seen = new Set();
  for (const record of scoped) {
    const key = `${record.kind}:${record.provisionalId}`;
    if (!validLocalRecord(record, workspaceKey, store) || seen.has(key)) {
      malformed += 1;
      continue;
    }
    seen.add(key);
    valid.push(record);
  }
  const idKinds = new Map();
  for (const record of valid) {
    const kinds = idKinds.get(record.provisionalId) || new Set();
    kinds.add(record.kind);
    idKinds.set(record.provisionalId, kinds);
  }
  const collisions = new Set([...idKinds].filter(([, kinds]) => kinds.size > 1).map(([id]) => id));
  const unambiguous = valid.filter(record => {
    if (!collisions.has(record.provisionalId)) return true;
    malformed += 1;
    return false;
  });
  const counts = { ...emptyCounts, workspaceRecords: unambiguous.length, malformed };
  const selected = [];
  for (const record of unambiguous) {
    if (record.destination === 'unknown') { counts.unknownDestination += 1; continue; }
    if (record.destination !== options.destination) { counts.destinationMismatch += 1; continue; }
    selected.push(record);
    if (record.kind === 'provisional-lesson') counts.lessons += 1;
    else counts.occurrences += 1;
  }
  const lessons = selected.filter(record => record.kind === 'provisional-lesson');
  const covered = new Set(lessons.map(record => record.signature));
  const candidates = lessons.map(record => localCandidate(
    'Local provisional lesson', record.signature, [record], record.match, ledger, store, options.destination
  ));
  const occurrences = new Map();
  for (const record of selected.filter(record => record.kind === 'occurrence')) {
    if (covered.has(record.signature)) { counts.suppressedOccurrences += 1; continue; }
    const group = occurrences.get(record.signature) || [];
    group.push(record);
    occurrences.set(record.signature, group);
  }
  for (const [signature, group] of occurrences) {
    candidates.push(localCandidate('Local tool-failure lead', signature, group, null, ledger, store, options.destination));
  }
  counts.candidates = candidates.length;
  const status = malformed || scoped.length === 0 ? 'unverified' : 'used';
  const reason = collisions.size ? 'provisional-id-collision' : malformed ? 'malformed-records' : scoped.length === 0 ? 'empty-reader-result' : undefined;
  return {
    source: sourceStatus('local-store', 'workspace', status, {
      ...(reason ? { reason } : {}), workspaceRef: ref, destination: options.destination,
      ledgerStatus: ledger.status, ...(ledger.reason ? { ledgerReason: ledger.reason } : {}), counts
    }),
    candidates
  };
}

function addAttachments(candidates, files, root, hideLedger) {
  const testFiles = files.filter(file => {
    const base = path.posix.basename(file);
    const testLike = /(?:^|[./_-])(?:test|tests|spec)(?:[./_-]|$)/i.test(base) || /(^|\/)(?:test|tests|__tests__)\//i.test(file);
    return testLike && (!hideLedger || !isLedgerPath(file));
  });
  for (const file of testFiles) {
    const full = path.join(root, file);
    const text = safeRead(full);
    if (text === null) continue;
    for (const item of candidates) {
      if (item.sites.some(site => text.includes(site) || importsSite(text, file, site)) &&
        !item.attachments.some(link => link.ref === file)) {
        item.attachments.push({ type: 'test-link', ref: file });
      }
    }
  }
  for (const item of candidates) item.attachments.sort((a, b) => a.ref.localeCompare(b.ref));
}

function importsSite(text, testFile, site) {
  const specifiers = /(?:\brequire(?:\.resolve)?\s*\(\s*|\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(specifiers)) {
    if (!match[1].startsWith('.')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(testFile), match[1]));
    if (resolved === site || (!path.posix.extname(resolved) &&
      (site.startsWith(`${resolved}.`) || site.startsWith(`${resolved}/index.`)))) return true;
  }
  return false;
}

function markdownReport(report) {
  const lines = [
    '# Error ledger candidate report',
    '',
    `- Schema version: ${report.schemaVersion}`,
    `- Root: \`${report.root}\``,
    `- Generated: ${report.generatedAt}`,
    `- Candidates: ${report.candidates.length}`,
    '',
    '## Options',
    '',
    `- hideLedger: ${report.options.hideLedger}`,
    `- noMemory: ${report.options.noMemory}`,
    `- memory: ${report.options.memory.length ? report.options.memory.map(value => `\`${value}\``).join(', ') : 'none'}`,
    `- instructions: ${report.options.instructions.length ? report.options.instructions.map(value => `\`${value}\``).join(', ') : 'none'}`,
    `- homeOverridden: ${report.options.homeOverridden}`,
    '',
    '## Sources',
    ''
  ];
  for (const source of report.sources) {
    const label = source.ref || (source.refs && source.refs.join(', ')) || source.origin;
    lines.push(`- \`${source.type}\` (${source.origin}) — **${source.status}** — ${label}${source.reason ? ` — ${source.reason}` : ''}${source.verified === undefined ? '' : ` — verified: ${source.verified}`}${source.verificationRef ? ` — verification: ${source.verificationRef}` : ''}`);
    if (source.type === 'local-store') {
      lines.push(`  - Workspace ref: \`${source.workspaceRef}\``, `  - Destination: \`${source.destination}\``,
        `  - Records: ${source.counts.workspaceRecords}; lessons: ${source.counts.lessons}; occurrences: ${source.counts.occurrences}; candidates: ${source.counts.candidates}`,
        `  - Destination mismatches: ${source.counts.destinationMismatch}; unknown destinations: ${source.counts.unknownDestination}; malformed: ${source.counts.malformed}; suppressed occurrences: ${source.counts.suppressedOccurrences}`,
        `  - Destination ledger dedupe: **${source.ledgerStatus}**${source.ledgerReason ? ` — ${source.ledgerReason}` : ''}`);
    }
  }
  lines.push('', '## Candidates', '');
  for (const item of report.candidates) {
    lines.push(`### ${item.title}`, '', `- ID: \`${item.id}\``, `- Kind: \`${item.kind}\``, `- Domain: \`${item.domain}\``, `- Signature: \`${item.signature}\``, `- Status: **${item.status}**`, `- Sites: ${item.sites.length ? item.sites.map(site => `\`${site}\``).join(', ') : 'none'}`, '- Sources:');
    if (item.local) {
      lines.push(`- Evidence readiness: **${item.local.evidenceReadiness}**`,
        `- Occurrence count: ${item.local.occurrenceCount}`,
        `- Destination dedupe: **${item.local.dedupe.status}**${item.local.dedupe.classIds.length ? ` — ${item.local.dedupe.classIds.map(id => `\`${id}\``).join(', ')}` : ''}`,
        `- Exact match signals: ${item.local.dedupe.matchedBy.length ? item.local.dedupe.matchedBy.join(', ') : 'none'}`,
        `- New-class dedupe eligible: ${item.local.dedupe.newClassEligible}`);
    }
    for (const source of item.sources) {
      lines.push(`  - \`${source.type}\` ${source.ref || source.path || source.sha}${source.path && source.sha ? ` — ${source.sha}` : ''}${source.subject ? ` — ${source.subject}` : ''}`);
    }
    lines.push('- Attachments:');
    if (item.attachments.length) {
      for (const attachment of item.attachments) lines.push(`  - \`${attachment.type}\` \`${attachment.ref}\``);
    } else lines.push('  - none');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function reportOptions(options, root, home) {
  return {
    hideLedger: options.hideLedger,
    noMemory: options.noMemory,
    memory: options.memory.map(localSourceId),
    instructions: options.instructions.map(localSourceId),
    homeOverridden: Boolean(options.home)
  };
}

function outputDirectory(options, root) {
  if (!options.out) {
    const tempRoot = path.resolve(os.tmpdir());
    const physicalTempRoot = resolveWithSymlinks(tempRoot);
    if (isWithin(root, tempRoot) || isWithin(root, physicalTempRoot)) {
      failure('system temporary directory is inside the target repository', 2);
    }
    const directory = fs.mkdtempSync(path.join(tempRoot, 'error-ledger-candidates-'));
    const physical = resolveWithSymlinks(directory);
    if (isWithin(root, directory) || isWithin(root, physical)) {
      fs.rmSync(directory, { recursive: true, force: true });
      failure('refusing output inside the target repository', 2);
    }
    try { fs.chmodSync(directory, 0o700); } catch (_) { /* mode bits are not available on every host */ }
    return { directory: physical, privateDefault: true };
  }
  const lexical = path.resolve(options.out);
  const resolved = resolveWithSymlinks(lexical);
  if (isWithin(root, lexical) || isWithin(root, resolved)) failure('refusing output inside the target repository', 2);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const physical = resolveWithSymlinks(resolved);
  if (isWithin(root, physical)) failure('refusing output inside the target repository', 2);
  return { directory: physical, privateDefault: false };
}

function writeReports(directory, report, root) {
  const jsonPath = path.join(directory, 'candidates.json');
  const markdownPath = path.join(directory, 'candidates.md');
  for (const target of [jsonPath, markdownPath]) {
    const lexical = path.resolve(target);
    const resolved = resolveWithSymlinks(target);
    if (isWithin(root, lexical) || isWithin(root, resolved)) failure('refusing report file inside the target repository', 2);
    if (fs.existsSync(target)) failure(`report output already exists: ${path.basename(target)}`, 2);
  }
  const files = [
    [jsonPath, `${JSON.stringify(report, null, 2)}\n`],
    [markdownPath, markdownReport(report)]
  ];
  const temps = [];
  const written = [];
  try {
    for (const [target, contents] of files) {
      const temp = path.join(directory, `.scan-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
      temps.push(temp);
      fs.writeFileSync(temp, contents, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, target);
      written.push(target);
    }
  } catch (cause) {
    for (const file of [...temps, ...written]) {
      try { fs.rmSync(file, { force: true }); } catch (_) {}
    }
    failure(`cannot write candidate reports: ${cause.message}`, 1);
  }
  return { reportJson: jsonPath, reportMd: markdownPath };
}

function scan(options) {
  const rootInput = path.resolve(options.root);
  let root;
  try {
    if (!fs.statSync(rootInput).isDirectory()) failure('--root must be a directory');
    root = canonical(rootInput);
  } catch (cause) {
    if (cause.exitCode) throw cause;
    failure('--root must be an existing Git repository directory');
  }
  const top = canonical(git(root, ['rev-parse', '--show-toplevel'], 'utf8', 2).trim());
  if (top !== root) failure('--root must be the Git repository root');
  const home = options.home ? path.resolve(options.home) : os.homedir();
  const historyCandidates = parseHistory(root, options.hideLedger);
  const files = repoFiles(root);
  const selected = collectSources(options, root, home, files, historyCandidates);
  if (options.source === 'local-store') {
    const local = collectLocalStore(options, root);
    selected.sources.push(local.source);
    selected.candidates.push(...local.candidates);
  }
  const candidates = [...new Map([...historyCandidates, ...selected.candidates].map(item => [item.id, item])).values()];
  addAttachments(candidates, files, root, options.hideLedger);
  for (const item of candidates) {
    for (const source of item.sources) {
      if (source.subject) source.subject = publicText(source.subject, root, home);
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  if (selected.sources.some(source => !SOURCE_STATUSES.has(source.status))) failure('invalid source status', 1);
  const report = {
    schemaVersion: 1,
    root: path.basename(root),
    generatedAt: new Date().toISOString(),
    options: reportOptions(options, root, home),
    sources: selected.sources,
    candidates
  };
  const output = outputDirectory(options, root);
  const paths = writeReports(output.directory, report, root);
  return {
    report,
    ...paths,
    counts: {
      candidates: candidates.length,
      git: historyCandidates.filter(item => item.sources.some(source => source.type === 'git')).length,
      doc: historyCandidates.filter(item => item.sources.some(source => source.type === 'doc')).length,
      tracker: candidates.filter(item => item.sources.some(source => source.type === 'tracker')).length,
      memory: candidates.filter(item => item.sources.some(source => source.type === 'memory')).length,
      instruction: candidates.filter(item => item.sources.some(source => source.type === 'instruction')).length
    }
  };
}

function main(args) {
  const jsonRequested = args.includes('--json');
  try {
    const options = parseArgs(args);
    const result = scan(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, reportJson: result.reportJson, reportMd: result.reportMd, counts: result.counts })}\n`);
    } else {
      process.stdout.write('Candidate reports written.\n');
    }
    return 0;
  } catch (cause) {
    const message = String(cause && cause.message || 'scan failed').replace(/[\r\n]+/g, ' ').trim() || 'scan failed';
    process.stderr.write(`${message}\n`);
    if (jsonRequested) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    return cause && cause.exitCode === 2 ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { isWithin };
