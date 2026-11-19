#!/usr/bin/env node
'use strict';

// Regenerates .agents/harness-everything/errors/index.jsonl from the E-*.md records.
// `--check` compares instead of writing. Not wired into CI or hooks on purpose.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const ERRORS_PATH = path.join('.agents', 'harness-everything', 'errors');
const DIR = path.join(ROOT, ERRORS_PATH);
const INDEX_NAME = 'index.jsonl';
const RECORD = /^E-\d{4}-[a-z0-9-]+\.md$/;
const REQUIRED = ['id', 'signature', 'class', 'scope', 'status'];
const SCOPES = new Set(['in', 'out', 'unresolved']);
const STATUSES = new Set(['open', 'lesson', 'mechanism']);

function errorsDirectory(root) {
  const resolvedRoot = path.resolve(root);
  const dir = path.join(resolvedRoot, ERRORS_PATH);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()
    || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`root ${JSON.stringify(resolvedRoot)} must exist and contain ${ERRORS_PATH}`);
  }
  return dir;
}

function parseRecord(file, dir = DIR) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const meta = yaml.load(match[1]);
  if (!meta || typeof meta !== 'object') throw new Error(`${file}: frontmatter is not a mapping`);
  for (const key of REQUIRED) {
    if (meta[key] === undefined || meta[key] === null || meta[key] === '') throw new Error(`${file}: missing ${key}`);
  }
  if (!file.startsWith(`${meta.id}-`)) throw new Error(`${file}: id ${meta.id} does not match the file name`);
  if (!SCOPES.has(meta.scope)) throw new Error(`${file}: scope must be in, out or unresolved`);
  if (!STATUSES.has(meta.status)) throw new Error(`${file}: status must be open, lesson or mechanism`);
  const episodes = Array.isArray(meta.episodes) ? meta.episodes : [];
  return {
    id: meta.id,
    signature: meta.signature,
    class: meta.class,
    title: meta.title || null,
    scope: meta.scope,
    status: meta.status,
    sites: Array.isArray(meta.sites) ? meta.sites : [],
    violates: meta.violates || null,
    mechanism_ref: meta.mechanism_ref || null,
    episodes: episodes.length,
    rounds: episodes.map(e => ({
      episode: e.episode || null,
      // Round 0 is discovery, so the attempt count is the highest round number.
      rounds: Array.isArray(e.rounds) ? Math.max(0, ...e.rounds.map(r => Number(r.round) || 0)) : null,
      closed: e.closed === true,
    })),
    file: path.posix.join('.agents/harness-everything/errors', file),
  };
}

function render(root = ROOT) {
  const dir = errorsDirectory(root);
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
    }
  }

  let next;
  let index;
  try {
    root = path.resolve(root);
    next = render(root);
    index = path.join(root, ERRORS_PATH, INDEX_NAME);
  } catch (error) {
    console.error(`errors:sync: ${error.message}`);
    process.exit(1);
  }
  const rel = path.relative(root, index).replace(/\\/g, '/');
  if (check) {
    const current = fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : null;
    if (current !== next) {
      console.error(`${rel} is stale. Run npm run errors:sync.`);
      process.exit(1);
    }
    console.log(`${rel} is current.`);
    return;
  }
  fs.writeFileSync(index, next, 'utf8');
  console.log(`Updated ${rel}`);
}

if (require.main === module) main();

module.exports = { render };
