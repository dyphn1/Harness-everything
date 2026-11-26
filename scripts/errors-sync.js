#!/usr/bin/env node
'use strict';

// Regenerates .agents/harness-everything/errors/index.jsonl from the E-*.md records.
// `--check` compares instead of writing. Not wired into CI or hooks on purpose.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const ERRORS_PATH = path.join('.agents', 'harness-everything', 'errors');
const DIR = path.join(ROOT, ERRORS_PATH);
const INDEX_NAME = 'index.jsonl';
const RECORD = /^E-\d{4}-[a-z0-9-]+\.md$/;
const REQUIRED = ['id', 'signature', 'class', 'scope', 'status'];
const SCOPES = new Set(['in', 'out', 'unresolved']);
const STATUSES = new Set(['open', 'lesson', 'mechanism']);
const MATCH_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isMatchId(value) {
  return typeof value === 'string' && MATCH_ID.test(value);
}

function parseMatch(match, file) {
  if (!match || typeof match !== 'object' || Array.isArray(match)
      || Object.keys(match).length === 0 || Object.keys(match).some(key => !['actions', 'failures'].includes(key))) {
    throw new Error(`${file}: invalid match: expected actions and/or failures only`);
  }

  const parsed = {};
  for (const phase of ['actions', 'failures']) {
    if (!Object.prototype.hasOwnProperty.call(match, phase)) continue;
    const rules = match[phase];
    if (!Array.isArray(rules) || rules.length < 1 || rules.length > 8) {
      throw new Error(`${file}: invalid match.${phase}: expected 1 to 8 rules`);
    }
    parsed[phase] = rules.map((rule, index) => {
      const failure = phase === 'failures';
      const keys = failure
        ? ['diagnostics', 'executable', 'subcommand', 'tool']
        : ['executable', 'subcommand', 'tool'];
      if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !hasExactKeys(rule, keys)) {
        throw new Error(`${file}: invalid match.${phase}[${index}]: rule keys must be exactly ${keys.join(', ')}`);
      }
      if (rule.tool !== 'shell') throw new Error(`${file}: invalid match.${phase}[${index}].tool: expected shell`);
      if (!isMatchId(rule.executable)) {
        throw new Error(`${file}: invalid match.${phase}[${index}].executable: expected a lowercase literal id of 1 to 64 characters`);
      }
      if (!isMatchId(rule.subcommand)) {
        throw new Error(`${file}: invalid match.${phase}[${index}].subcommand: expected a lowercase literal id of 1 to 64 characters`);
      }
      const parsedRule = { tool: 'shell', executable: rule.executable, subcommand: rule.subcommand };
      if (failure) {
        const diagnostics = rule.diagnostics;
        if (!Array.isArray(diagnostics) || diagnostics.length < 1 || diagnostics.length > 16
            || !diagnostics.every(isMatchId) || new Set(diagnostics).size !== diagnostics.length) {
          throw new Error(`${file}: invalid match.failures[${index}].diagnostics: expected 1 to 16 unique lowercase literal ids of 1 to 64 characters`);
        }
        parsedRule.diagnostics = [...diagnostics];
      }
      return parsedRule;
    });
  }
  return parsed;
}

function errorsDirectory(root) {
  const resolvedRoot = path.resolve(root);
  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync.native ? fs.realpathSync.native(resolvedRoot) : fs.realpathSync(resolvedRoot);
    if (!fs.statSync(canonicalRoot).isDirectory()) throw new Error('not a directory');
  } catch (_) {
    throw new Error(`root ${JSON.stringify(resolvedRoot)} must exist and contain ${ERRORS_PATH}`);
  }

  let dir = canonicalRoot;
  for (const part of ERRORS_PATH.split(path.sep)) {
    const candidate = path.join(dir, part);
    let stat;
    try {
      stat = fs.lstatSync(candidate);
      dir = fs.realpathSync.native ? fs.realpathSync.native(candidate) : fs.realpathSync(candidate);
    } catch (_) {
      throw new Error(`root ${JSON.stringify(resolvedRoot)} must exist and contain ${ERRORS_PATH}`);
    }
    const inside = path.relative(canonicalRoot, dir);
    if (path.isAbsolute(inside) || inside === '..' || inside.startsWith(`..${path.sep}`)) {
      throw new Error(`ledger path ${part} resolves outside target root`);
    }
    if (part === 'errors' && (stat.isSymbolicLink() || !samePath(candidate, dir))) {
      throw new Error('errors directory must not be a symlink or junction');
    }
    if (!fs.statSync(dir).isDirectory()) {
      throw new Error(`root ${JSON.stringify(resolvedRoot)} must exist and contain ${ERRORS_PATH}`);
    }
  }
  return dir;
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function parseRecord(file, dir = DIR) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const rawFrontmatter = match[1].replace(/\r\n?/g, '\n');
  const meta = yaml.load(rawFrontmatter);
  if (!meta || typeof meta !== 'object') throw new Error(`${file}: frontmatter is not a mapping`);
  for (const key of REQUIRED) {
    if (meta[key] === undefined || meta[key] === null || meta[key] === '') throw new Error(`${file}: missing ${key}`);
  }
  if (!file.startsWith(`${meta.id}-`)) throw new Error(`${file}: id ${meta.id} does not match the file name`);
  if (!SCOPES.has(meta.scope)) throw new Error(`${file}: scope must be in, out or unresolved`);
  if (!STATUSES.has(meta.status)) throw new Error(`${file}: status must be open, lesson or mechanism`);
  const episodes = Array.isArray(meta.episodes) ? meta.episodes : [];
  const record = {
    id: meta.id,
    signature: meta.signature,
    class: meta.class,
    title: meta.title || null,
    scope: meta.scope,
    status: meta.status,
    sites: Array.isArray(meta.sites) ? meta.sites : [],
    violates: meta.violates || null,
    mechanism_ref: meta.mechanism_ref || null,
    ...(Object.prototype.hasOwnProperty.call(meta, 'match') ? { match: parseMatch(meta.match, file) } : {}),
    episodes: episodes.length,
    rounds: episodes.map(e => ({
      episode: e.episode || null,
      // Round 0 is discovery, so the attempt count is the highest round number.
      rounds: Array.isArray(e.rounds) ? Math.max(0, ...e.rounds.map(r => Number(r.round) || 0)) : null,
      closed: e.closed === true,
    })),
    file: path.posix.join('.agents/harness-everything/errors', file),
  };
  if (record.match) {
    record.matchBinding = crypto.createHash('sha256').update(JSON.stringify([
      rawFrontmatter, record.id, record.signature, record.file, record.match
    ])).digest('hex');
  }
  return record;
}

function renderDirectory(dir) {
  const files = fs.readdirSync(dir).filter(f => RECORD.test(f)).sort();
  const ids = new Set();
  const lines = files.map(file => {
    const record = parseRecord(file, dir);
    if (ids.has(record.id)) throw new Error(`${file}: duplicate id ${record.id}`);
    ids.add(record.id);
    return JSON.stringify(record);
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function render(root = ROOT) {
  return renderDirectory(errorsDirectory(root));
}

function inspectIndex(index) {
  try {
    // Keep 64-bit device/file IDs exact (Windows IDs can exceed Number's safe integer range).
    const stat = fs.lstatSync(index, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('target index must be a regular file inside the errors directory');
    }
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readIndex(index) {
  const before = inspectIndex(index);
  if (!before) return null;
  let fd;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    fd = fs.openSync(index, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('target index changed while it was being read');
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeIndex(index, content, root) {
  const dir = path.dirname(index);
  if (!samePath(path.resolve(errorsDirectory(root)), path.resolve(dir))) {
    throw new Error('errors directory changed before index publication');
  }
  const previous = inspectIndex(index);
  const previousBytes = previous ? readIndex(index) : null;
  const mode = previous ? Number(previous.mode) & 0o777 : 0o666;
  let temporary;
  let fd;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      temporary = path.join(dir, `.${INDEX_NAME}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      try {
        fd = fs.openSync(temporary, 'wx', mode);
        break;
      } catch (error) {
        temporary = undefined;
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (fd === undefined) throw new Error('could not allocate an exclusive temporary index file');
    if (previous) fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, content, 'utf8');
    const openFd = fd;
    fd = undefined;
    fs.closeSync(openFd);

    const currentDir = errorsDirectory(root);
    if (!samePath(path.resolve(currentDir), path.resolve(dir))) throw new Error('errors directory changed before index publication');
    const current = inspectIndex(index);
    if (Boolean(current) !== Boolean(previous) || (current && (
      current.dev !== previous.dev || current.ino !== previous.ino || readIndex(index) !== previousBytes
    ))) throw new Error('target index changed before publication');
    fs.renameSync(temporary, index);
    temporary = undefined;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* still remove the temporary file */ }
    }
    if (temporary) {
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  let check = false;
  let root = ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') {
      check = true;
    } else if (args[i] === '--root') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        console.error('errors:sync: --root requires a directory');
        process.exit(1);
      }
      root = path.resolve(args[++i]);
    } else if (args[i].startsWith('--root=')) {
      const value = args[i].slice('--root='.length);
      if (!value) {
        console.error('errors:sync: --root requires a directory');
        process.exit(1);
      }
      root = path.resolve(value);
    } else {
      console.error(`errors:sync: unsupported argument ${JSON.stringify(args[i])}`);
      process.exit(1);
    }
  }

  let next;
  let index;
  let directory;
  try {
    root = path.resolve(root);
    directory = errorsDirectory(root);
    index = path.join(directory, INDEX_NAME);
    inspectIndex(index);
    next = renderDirectory(directory);
  } catch (error) {
    console.error(`errors:sync: ${error.message}`);
    process.exit(1);
  }
  const rel = path.relative(root, index).replace(/\\/g, '/');
  if (check) {
    let current;
    try {
      current = readIndex(index);
    } catch (error) {
      console.error(`errors:sync: ${error.message}`);
      process.exit(1);
    }
    if (current !== next) {
      console.error(`${rel} is stale. Run npm run errors:sync.`);
      process.exit(1);
    }
    console.log(`${rel} is current.`);
    return;
  }
  try {
    writeIndex(index, next, root);
  } catch (error) {
    console.error(`errors:sync: ${error.message}`);
    process.exit(1);
  }
  console.log(`Updated ${rel}`);
}

if (require.main === module) main();

module.exports = { render };
