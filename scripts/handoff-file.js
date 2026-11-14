#!/usr/bin/env node
'use strict';

// Agents hand each other Markdown work orders, and script-generating them keeps
// the format from drifting. The file begins with a tiny YAML front matter
// header; System One reads only that header as input (#409 L0). The YAML subset
// is flat scalars and flat lists, emitted and parsed here with no dependency.

const fs = require('fs');
const path = require('path');

const HEADER_LIMIT = 2048;
const KINDS = ['implement', 'test', 'review', 'design', 'question', 'answer'];
const KEY_ORDER = ['harness-handoff', 'kind', 'title', 'summary', 'writes', 'gate', 'report'];
const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~', 'nan', 'inf']);

const BODY = [
  '## Scope anchor',
  '',
  '## Task',
  '',
  '## Write-set',
  '',
  '## Verification',
  '',
  '## Report',
  '',
  '<!-- STATUS: <pending> -->',
  '',
].join('\n');

function fail(message) {
  process.stderr.write(`handoff-file: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write([
    'Usage:',
    '  handoff-file.js new --kind <implement|test|review|design|question|answer>',
    '                     --title "<text>" --summary "<text>" --out <file.md>',
    '                     [--writes a,b] [--gate "<text>"] [--report <path>]',
    '  handoff-file.js header <file.md>',
    '  handoff-file.js check <file.md>',
    '',
  ].join('\n'));
  process.exit(1);
}

function plainSafe(value) {
  if (!value || value !== value.trim()) return false;
  if (RESERVED.has(value.toLowerCase())) return false;
  return /^[A-Za-z0-9_/][A-Za-z0-9 _.@/()+-]*$/.test(value);
}

function yamlScalar(value) {
  const s = String(value);
  if (plainSafe(s)) return s;
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function unquote(raw) {
  const s = raw.trim();
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  let out = '';
  for (let i = 1; i < s.length - 1; i += 1) {
    if (s[i] !== '\\') {
      out += s[i];
      continue;
    }
    const next = s[i + 1];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else out += next === undefined ? '\\' : next;
    i += 1;
  }
  return out;
}

function parseValue(raw) {
  if (raw === undefined) return '';
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map(unquote);
  }
  return unquote(s);
}

function renderHeader(header) {
  const lines = ['---'];
  for (const key of KEY_ORDER) {
    if (!(key in header)) continue;
    const value = header[key];
    const rendered = key === 'writes' ? `[${value.map(yamlScalar).join(', ')}]` : yamlScalar(value);
    lines.push(`${key}: ${rendered}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function parseHeader(file) {
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEADER_LIMIT);
    const read = fs.readSync(fd, buf, 0, HEADER_LIMIT, 0);
    fs.closeSync(fd);
    text = buf.subarray(0, read).toString('utf8');
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
  if (!/^---(\r?\n|$)/.test(text)) fail(`${file}: no handoff header (file must start with '---')`);
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!block) fail(`${file}: header exceeds ${HEADER_LIMIT} bytes or is unterminated`);
  if (Buffer.byteLength(block[0], 'utf8') > HEADER_LIMIT) {
    fail(`${file}: header exceeds ${HEADER_LIMIT} bytes`);
  }
  const header = {};
  for (const line of block[1].split(/\r?\n/)) {
    if (line === '') continue;
    const kv = /^([A-Za-z][A-Za-z0-9-]*):(?:[ ](.*))?$/.exec(line);
    if (!kv) fail(`${file}: malformed header line ${JSON.stringify(line)}`);
    if (kv[1] in header) fail(`${file}: duplicate header key ${kv[1]}`);
    header[kv[1]] = parseValue(kv[2]);
  }
  return header;
}

function normalize(header) {
  const out = {};
  for (const key of KEY_ORDER) {
    if (key in header) out[key] = key === 'harness-handoff' ? Number(header[key]) : header[key];
  }
  return out;
}

function validate(file, header) {
  const unknown = Object.keys(header).filter((key) => !KEY_ORDER.includes(key));
  if (unknown.length) fail(`${file}: unknown header key(s): ${unknown.join(', ')}`);
  if (Number(header['harness-handoff']) !== 1) fail(`${file}: harness-handoff must be 1`);
  if (!KINDS.includes(header.kind)) fail(`${file}: kind must be one of ${KINDS.join('|')}`);
  if (typeof header.title !== 'string' || header.title === '') fail(`${file}: title is required`);
  if (typeof header.summary !== 'string' || header.summary === '') fail(`${file}: summary is required`);
  if ([...header.summary].length > 200) fail(`${file}: summary must be at most 200 characters`);
  if ('writes' in header && !Array.isArray(header.writes)) fail(`${file}: writes must be a list`);
  for (const key of ['gate', 'report']) {
    if (key in header && typeof header[key] !== 'string') fail(`${file}: ${key} must be a string`);
  }
}

function loadHeader(file) {
  const header = parseHeader(file);
  validate(file, header);
  return normalize(header);
}

function parseFlags(args, allowed) {
  const opts = {};
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (!flag.startsWith('--')) fail(`unexpected argument ${JSON.stringify(flag)}`);
    const name = flag.slice(2);
    if (!allowed.includes(name)) fail(`unknown flag ${flag}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`);
    opts[name] = value;
    i += 1;
  }
  return opts;
}

function createHandoff(args) {
  const opts = parseFlags(args, ['kind', 'title', 'summary', 'out', 'writes', 'gate', 'report']);
  for (const key of ['kind', 'title', 'summary', 'out']) {
    if (!opts[key]) fail(`new requires --${key}`);
  }
  const header = { 'harness-handoff': 1, kind: opts.kind, title: opts.title, summary: opts.summary };
  if (opts.writes !== undefined) {
    // shortcut: a comma inside one write path splits it into two items, upgrade if a path may hold one
    header.writes = opts.writes.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }
  if (opts.gate !== undefined) header.gate = opts.gate;
  if (opts.report !== undefined) header.report = opts.report;
  validate(opts.out, header);
  const rendered = renderHeader(header);
  if (Buffer.byteLength(rendered, 'utf8') > HEADER_LIMIT) fail(`${opts.out}: header exceeds ${HEADER_LIMIT} bytes`);
  const target = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${rendered}\n${BODY}`, 'utf8');
  process.stdout.write(`${target}\n`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'new') {
    createHandoff(rest);
  } else if (command === 'header' || command === 'check') {
    const file = rest[0];
    if (!file) fail(`${command} requires <file.md>`);
    const header = loadHeader(file);
    process.stdout.write(
      command === 'header' ? `${JSON.stringify(header, null, 2)}\n` : `${file}: ok (kind=${header.kind})\n`,
    );
  } else {
    usage();
  }
}

main();
