'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const STEPS = ['collect', 'label', 'judge', 'build', 'train', 'evaluate', 'package', 'publish'];

function readJsonl(file, optional = false) {
  if (optional && !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.basename(file)} line ${index + 1} is not valid JSON`); }
  });
}

function writeJsonl(file, rows, { append = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  if (append) fs.appendFileSync(file, body, { mode: 0o600 });
  else fs.writeFileSync(file, body, { mode: 0o600 });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('--')) throw new Error('unexpected positional argument');
    const key = token.slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    if (Object.hasOwn(flags, key)) flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value];
    else flags[key] = value;
  }
  return flags;
}

function flag(flags, name, fallback) {
  const value = flags[name];
  return value === undefined ? fallback : Array.isArray(value) ? value.at(-1) : value;
}

function required(flags, name) {
  const value = flag(flags, name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} is required`);
  return value;
}

function dataPath(dataDir, ...parts) {
  return path.join(path.resolve(dataDir), ...parts);
}

function readState(dataDir) {
  const file = dataPath(dataDir, 'cycle-state.json');
  if (!fs.existsSync(file)) return { schemaVersion: 1, steps: {} };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.schemaVersion !== 1 || !state.steps || typeof state.steps !== 'object') throw new Error('invalid cycle-state.json');
  return state;
}

function stepComplete(dataDir, step) {
  const entry = readState(dataDir).steps[step];
  return !!entry && typeof entry.completedAt === 'string'
    && (!Array.isArray(entry.outputs) || entry.outputs.every(file => fs.existsSync(dataPath(dataDir, file))));
}

function markStep(dataDir, step, outputs = []) {
  const state = readState(dataDir);
  state.steps[step] = { completedAt: new Date().toISOString(), outputs };
  writeJson(dataPath(dataDir, 'cycle-state.json'), state);
}

function runNode(script, args, { cwd = REPO, env = process.env } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env, stdio: 'ignore', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(script)} failed${result.status === null ? '' : ` (${result.status})`}`);
}

function assertPrivateDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let target = path.resolve(dataDir);
  let repo = REPO;
  try { target = fs.realpathSync.native(target); repo = fs.realpathSync.native(REPO); } catch { /* path resolution below still checks the visible root */ }
  const relative = path.relative(repo, target);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('private cycle data must be stored outside the repository');
  }
  if (process.platform !== 'win32') fs.chmodSync(target, 0o700);
  return target;
}

function resultSummary(step, details) {
  return { step, ...details };
}

module.exports = {
  REPO, STEPS, readJsonl, writeJsonl, writeJson, parseFlags, flag, required, dataPath,
  readState, stepComplete, markStep, runNode, assertPrivateDataDir, resultSummary,
};
