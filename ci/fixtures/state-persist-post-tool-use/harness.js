'use strict';

// Test-only harness for the general state-persist PostToolUse compatibility
// controls. Copies the capture fixture's two-leg loader/driver contract so the
// moved controls keep the same input, same assertion and both real hook legs
// (canonical hooks/scripts + packaged plugins/harness-everything copy).
// No runtime module is required at load time; R2 may retire the E1 modules
// without affecting these controls.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..', '..');

const LEGS = [
  {
    name: 'source',
    hooksScripts: path.join(ROOT, 'hooks', 'scripts'),
    hooksManifest: path.join(ROOT, 'hooks', 'hooks.json'),
    lib: path.join(ROOT, 'hooks', 'scripts', 'lib'),
  },
  {
    name: 'packaged',
    hooksScripts: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts'),
    hooksManifest: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'hooks.json'),
    lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib'),
  },
];

class InfraError extends Error {}

const CAPTURE_EVENT_NAMES = ['PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'];
const CAPTURE_BASE_REQUIRED = ['event', 'command', 'cwd', 'tool_use_id', 'session_id', 'responseDigest', 'responseRef'];

function payload(name) {
  return JSON.parse(fs.readFileSync(path.join(HERE, name), 'utf8'));
}

function golden() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'off-handoff-golden.json'), 'utf8'));
}

const moduleCache = new Map();
function loadModule(leg, file) {
  const key = `${leg.name}:${file}`;
  if (moduleCache.has(key)) return moduleCache.get(key);
  const abs = path.join(leg.lib, file);
  const rel = path.relative(ROOT, abs);
  let result;
  if (!fs.existsSync(abs)) {
    result = { error: `module-missing: ${rel} does not exist` };
  } else {
    try {
      result = { mod: require(abs) };
    } catch (error) {
      result = { error: `load-error: ${rel}: ${String(error && error.message).split('\n')[0]}` };
    }
  }
  moduleCache.set(key, result);
  return result;
}

function requirementsMet(leg, requirements) {
  const mods = {};
  for (const req of requirements || []) {
    const loaded = loadModule(leg, req.file);
    if (loaded.error) return { error: loaded.error };
    for (const name of req.exports || []) {
      if (typeof loaded.mod[name] !== 'function') {
        return { error: `export-missing: ${req.file} does not export ${name}` };
      }
    }
    mods[req.file] = loaded.mod;
  }
  return { mods };
}

function createRunner(label) {
  const rows = [];
  const counts = { PASS: 0, FAIL: 0, INFRA: 0 };
  function emit(status, id, leg, detail) {
    counts[status] += 1;
    rows.push({ status, id, leg, detail: detail || '' });
    console.log(`  ${status} ${id}${leg ? ` [${leg}]` : ''}${detail ? ` — ${detail}` : ''}`);
  }
  function run(id, requirements, fn) {
    for (const leg of LEGS) {
      const met = requirementsMet(leg, requirements);
      if (met.error) { emit('FAIL', id, leg.name, met.error); continue; }
      try {
        fn(met.mods, leg);
        emit('PASS', id, leg.name);
      } catch (error) {
        if (error instanceof InfraError) emit('INFRA', id, leg.name, String(error && error.message).split('\n')[0]);
        else emit('FAIL', id, leg.name, String(error && error.message).split('\n')[0]);
      }
    }
  }
  function summary() {
    console.log(`\n${label} summary: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.INFRA} INFRA across ${rows.length} assertion-legs`);
    return counts;
  }
  return { run, summary, counts, rows, emit };
}

function sessionDirectoryNameSafe(sessionId) {
  return String(sessionId || 'default').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
}

function snapshotSessionTree(stateHome, sessionId) {
  const dirName = sessionDirectoryNameSafe(sessionId);
  const hits = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (abs.split(path.sep).includes(dirName)) hits.push(abs);
    }
  })(stateHome);
  const files = {};
  for (const abs of hits) files[path.relative(stateHome, abs).replace(/\\/g, '/')] = fs.readFileSync(abs, 'utf8');
  return files;
}

function driveStatePersist(leg, baseName, overrides = {}, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'state-persist-post-'));
  const wsRoot = path.join(home, 'ws');
  fs.mkdirSync(wsRoot, { recursive: true });
  const stateHome = path.join(home, 'state-home');
  fs.mkdirSync(stateHome, { recursive: true });
  const driven = JSON.parse(JSON.stringify(payload(baseName)));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete driven[k];
    else driven[k] = v;
  }
  driven.cwd = wsRoot;
  const env = {
    ...process.env,
    CLAUDE: '1',
    HARNESS_STATE_HOME: stateHome,
    HARNESS_WORKSPACE_ROOT: wsRoot,
    ...(options.env || {}),
  };
  let result;
  try {
    result = spawnSync('node', [path.join(leg.hooksScripts, 'state-persist.js')], {
      input: JSON.stringify(driven),
      encoding: 'utf8',
      env,
      timeout: 30000,
    });
  } catch (error) {
    throw new InfraError(`state-persist subprocess could not be started: ${error.message}`);
  }
  if (result.error) throw new InfraError(`state-persist subprocess error: ${String(result.error.message || result.error)}`);
  const out = {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    files: snapshotSessionTree(stateHome, driven.session_id),
    filesRoot: stateHome,
    wsRoot,
    payload: driven,
  };
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  return out;
}

function deepScan(value, visit) {
  if (value && typeof value === 'object') {
    visit(value);
    if (Array.isArray(value)) for (const item of value) deepScan(item, visit);
    else for (const key of Object.keys(value)) deepScan(value[key], visit);
  }
}

function findCaptureRecords(files) {
  const found = [];
  for (const content of Object.values(files)) {
    let parsed;
    try { parsed = JSON.parse(content); } catch { continue; }
    deepScan(parsed, node => {
      if (node && CAPTURE_EVENT_NAMES.includes(node.event)
        && CAPTURE_BASE_REQUIRED.every(k => Object.prototype.hasOwnProperty.call(node, k))) {
        found.push(node);
      }
    });
  }
  return found;
}

module.exports = {
  ROOT,
  LEGS,
  InfraError,
  payload,
  golden,
  createRunner,
  requirementsMet,
  driveStatePersist,
  findCaptureRecords,
};
