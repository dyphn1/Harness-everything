'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_PATHS = 3;
const MAX_FILE_BYTES = 1024 * 1024;
const HANDOFF_READER_PATHS = [
  path.resolve(__dirname, '../../../scripts/handoff-file.js'),
  path.resolve(__dirname, '../../../../scripts/handoff-file.js'),
];
let loadHeader;

function pathCandidates(prompt) {
  const candidates = [];
  const tokens = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let match;
  while (candidates.length < MAX_PATHS && (match = tokens.exec(prompt))) {
    let value = match[1] ?? match[2] ?? match[3] ?? match[4];
    value = value.replace(/^\[[^\]]*\]\((.*)\)$/, '$1')
      .replace(/^[<([{]+/, '').replace(/[>)\]},.;!?]+$/, '');
    if (!value || /^(?:https?|file):\/\//i.test(value)) continue;
    if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')
      || /\.[A-Za-z0-9_-]{1,16}$/.test(value)) candidates.push(value);
  }
  return candidates;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function reader() {
  if (!loadHeader) {
    const file = HANDOFF_READER_PATHS.find(candidate => fs.existsSync(candidate));
    if (!file) throw new Error('handoff reader unavailable');
    ({ loadHeader } = require(file));
  }
  return loadHeader;
}

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function prepareHandoffInput(prompt, cwd = process.cwd()) {
  const original = typeof prompt === 'string' ? prompt : String(prompt ?? '');
  const lines = [];
  try {
    const root = fs.realpathSync.native(path.resolve(cwd));
    for (const value of pathCandidates(original)) {
      try {
        const absolute = path.isAbsolute(value);
        const candidate = path.resolve(root, value);
        if (!absolute && !isWithin(root, candidate)) continue;
        const file = fs.realpathSync.native(candidate);
        if (!absolute && !isWithin(root, file)) continue;
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        const header = reader()(file);
        lines.push(`[handoff] kind=${header.kind} title=${oneLine(header.title)} summary=${oneLine(header.summary)}`);
      } catch (_) {
        // Missing files and invalid headers do not affect the lexical route.
      }
    }
  } catch (_) {
    // Path resolution is advisory; keep the original scorer input on any error.
  }
  return {
    input: lines.length ? `${original}${original.endsWith('\n') ? '' : '\n'}${lines.join('\n')}` : original,
    handoffFiles: lines.length,
  };
}

module.exports = { prepareHandoffInput };
