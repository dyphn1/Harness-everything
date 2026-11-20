#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validLabel } = require('../hooks/scripts/lib/observations');

const USAGE = 'usage: report-writer write --output <path> --status <DONE|BLOCKED|0|nonzero-int> (--body-file <path>|--context <text>|--from-codex-output <path>) [--reason <text>|--error <text>...] | report-writer check --file <path>';
const WRITE_OPTIONS = new Set(['--output', '--status', '--reason', '--error', '--body-file', '--context', '--from-codex-output']);
const LABEL_MARKER = '<!-- harness-label';

function error(message) {
  throw new Error(message);
}

function parseOptions(args, allowed, repeatable = new Set()) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.has(key)) error(`unknown option: ${key}`);
    if (i + 1 >= args.length) error(`missing value for ${key}`);
    if (options.has(key) && !repeatable.has(key)) error(`duplicate option: ${key}`);
    if (repeatable.has(key)) options.set(key, [...(options.get(key) || []), args[i + 1]]);
    else options.set(key, args[i + 1]);
  }
  return options;
}

function required(options, key) {
  const value = options.get(key);
  if (value === undefined || value === '') error(`missing value for ${key}`);
  return value;
}

function singleLine(value, name) {
  if (/\r|\n/.test(value)) error(`${name} must be a single line`);
  return value;
}

function statusFrom(options) {
  const value = singleLine(required(options, '--status'), 'status');
  const reason = options.get('--reason');
  const errors = options.get('--error') || [];

  let done;
  if (value === 'DONE' || value === '0') done = true;
  else if (value === 'BLOCKED') done = false;
  else if (/^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value))) done = Number(value) === 0;
  else error('status must be DONE, BLOCKED, 0, or a nonzero integer');

  if (done) {
    if (reason !== undefined || errors.length) error('DONE status cannot include a reason or error');
    return 'STATUS: DONE';
  }
  if (reason !== undefined && errors.length) error('provide either --reason or --error, not both');
  const message = reason !== undefined ? reason : errors.join('; ');
  if (message === undefined || message.trim() === '') error('BLOCKED status requires a nonempty --reason or --error');
  singleLine(message, 'reason');
  return `STATUS: BLOCKED: ${message.trim()}`;
}

function splitLines(text) {
  if (/\r(?!\n)/.test(text)) error('bare carriage return is not a valid line ending');
  const lines = [];
  const separators = /\r\n|\n/g;
  let start = 0;
  let match;
  while ((match = separators.exec(text))) {
    lines.push({ value: text.slice(start, match.index), start, eol: match[0] });
    start = separators.lastIndex;
  }
  if (start < text.length || text.length === 0 || !text.endsWith('\n')) {
    lines.push({ value: text.slice(start), start, eol: '' });
  }
  return lines;
}

function statusLineStatus(line) {
  if (line === 'STATUS: DONE') return 'STATUS: DONE';
  const blocked = /^STATUS: BLOCKED: (.+)$/.exec(line);
  if (blocked && blocked[1].trim() !== '') return line;
  error('expected STATUS: DONE or STATUS: BLOCKED: <reason>');
}

function validateReport(text) {
  if (text.includes(LABEL_MARKER)) error('report contains a host label marker');
  const lines = splitLines(text);
  const controls = lines.filter(line => line.value.startsWith('STATUS:'));
  if (controls.length !== 1) error(`expected exactly one STATUS line; found ${controls.length}`);
  const last = lines[lines.length - 1];
  if (!last || !last.value.startsWith('STATUS:')) error('STATUS line must be terminal with nothing after it');
  return statusLineStatus(last.value);
}

function validateBody(body) {
  if (body.includes(LABEL_MARKER)) error('body contains a host label marker');
  if (splitLines(body).some(line => line.value.startsWith('STATUS:'))) {
    error('body contains a column-zero STATUS line');
  }
}

function parseHostLabel(line) {
  const prefix = '<!-- harness-label ';
  const suffix = ' -->';
  if (!line.startsWith(prefix) || !line.endsWith(suffix)) error('malformed terminal host label');
  let value;
  try {
    value = JSON.parse(line.slice(prefix.length, -suffix.length));
  } catch {
    error('terminal host label must contain valid JSON');
  }
  if (!validLabel(value)) error('terminal host label must use the recognized harness-label schema');
}

function extractCodexBody(raw, expectedStatus) {
  const lines = splitLines(raw);
  let strippedLabel = false;
  let bodyEnd = raw.length;
  const markers = lines.filter(line => line.value.includes(LABEL_MARKER));

  if (markers.length) {
    if (markers.length !== 1 || markers[0] !== lines[lines.length - 1]) error('host label is allowed only once at EOF');
    parseHostLabel(lines[lines.length - 1].value);
    strippedLabel = true;
    bodyEnd = lines[lines.length - 1].start;
  }

  const controls = lines.filter(line => line.value.startsWith('STATUS:'));
  if (controls.length > 1) error(`raw output must contain exactly one STATUS line; found ${controls.length}`);
  if (controls.length === 1) {
    const statusIndex = lines.indexOf(controls[0]);
    const terminalIndex = lines.length - (strippedLabel ? 2 : 1);
    if (statusIndex !== terminalIndex) error('raw STATUS must be terminal or immediately before the host label');
    if (controls[0].value !== expectedStatus) error('raw terminal STATUS does not match the requested status');
    if (strippedLabel && !controls[0].eol) error('host label must be on the line immediately after STATUS');
    bodyEnd = controls[0].start;
  }

  const body = raw.slice(0, bodyEnd);
  validateBody(body);
  return { body, strippedLabel };
}

function assertDistinctFiles(input, output) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (inputPath === outputPath) error('output aliases an input file');

  const inputStat = fs.statSync(inputPath);
  try {
    const outputStat = fs.statSync(outputPath);
    if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) error('output aliases an input file');
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
    try {
      const candidate = path.join(fs.realpathSync(path.dirname(outputPath)), path.basename(outputPath));
      if (candidate === fs.realpathSync(inputPath)) error('output aliases an input file');
    } catch (parentError) {
      if (parentError.code !== 'ENOENT') throw parentError;
    }
  }
}

function readText(file, description) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (cause) {
    error(`cannot read ${description} ${file}: ${cause.message}`);
  }
}

function reportBytes(body, statusLine) {
  validateBody(body);
  const newline = body.endsWith('\r\n') ? '\r\n' : '\n';
  const separator = body === '' || body.endsWith('\n') ? '' : newline;
  return Buffer.from(`${body}${separator}${statusLine}${newline}`, 'utf8');
}

function atomicWrite(output, bytes, expectedStatus) {
  const directory = path.dirname(output);
  const temp = path.join(directory, `.${path.basename(output)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  let published = false;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o666);
    fs.writeFileSync(descriptor, bytes);
    fs.closeSync(descriptor);
    descriptor = undefined;

    const staged = fs.readFileSync(temp);
    if (!staged.equals(bytes)) error('staged report bytes differ from the intended report');
    if (validateReport(staged.toString('utf8')) !== expectedStatus) error('staged report status differs from the requested status');

    fs.renameSync(temp, output);
    published = true;

    const actual = fs.readFileSync(output);
    if (!actual.equals(bytes)) error('published report bytes differ from the staged report');
    if (validateReport(actual.toString('utf8')) !== expectedStatus) error('published report status differs from the requested status');
  } catch (cause) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temp); } catch {}
    if (published) error(`report was published but could not be verified; coordinator disposition required: ${cause.message}`);
    error(`could not publish report before replacement: ${cause.message}`);
  }
}

function write(args) {
  const options = parseOptions(args, WRITE_OPTIONS, new Set(['--error']));
  const output = path.resolve(required(options, '--output'));
  const expectedStatus = statusFrom(options);
  const modes = ['--body-file', '--context', '--from-codex-output'].filter(key => options.has(key));
  if (modes.length !== 1) error('provide exactly one of --body-file, --context, or --from-codex-output');

  let body;
  let strippedLabel = false;
  if (modes[0] === '--context') {
    body = options.get('--context');
  } else {
    const input = required(options, modes[0]);
    assertDistinctFiles(input, output);
    const contents = readText(path.resolve(input), modes[0] === '--body-file' ? 'body file' : 'raw Codex output');
    if (modes[0] === '--from-codex-output') {
      const extracted = extractCodexBody(contents, expectedStatus);
      body = extracted.body;
      strippedLabel = extracted.strippedLabel;
    } else {
      body = contents;
    }
  }

  validateBody(body);
  const bytes = reportBytes(body, expectedStatus);
  atomicWrite(output, bytes, expectedStatus);
  if (strippedLabel) console.error('report-writer: stripped the terminal host label from raw Codex output');
  console.log(`Wrote ${output}`);
}

function check(args) {
  const options = parseOptions(args, new Set(['--file']));
  if (options.size !== 1) error('check requires only --file <path>');
  const file = path.resolve(required(options, '--file'));
  const status = validateReport(readText(file, 'report'));
  console.log(`${file}: valid (${status})`);
}

function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'write') write(args);
    else if (command === 'check') check(args);
    else error(USAGE);
  } catch (cause) {
    console.error(`report-writer: ${cause.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
