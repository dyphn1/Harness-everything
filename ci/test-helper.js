const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.env.CLAUDE = '1'; // Force Claude Code state path

const { getWorkspaceRoot, getSessionDir } = require('../hooks/scripts/lib/harness-state');

const root = getWorkspaceRoot();
const hooksDir = path.join(root, 'hooks', 'scripts');
const SESSION_ID = '__mechanism_test__';
const sessionDir = getSessionDir(root, SESSION_ID);

// Create session directory
fs.mkdirSync(sessionDir, { recursive: true });

const tempFiles = [];
const tempDirs = [];
const state = { failures: 0 };

function check(name, condition, detail) {
  if (condition) {
    console.log(`✅ ${name}`);
  } else {
    console.error(`❌ ${name}`);
    if (detail) console.error(`   ${detail}`);
    state.failures++;
  }
}

function runHook(scriptName, payload, extraEnv) {
  const scriptPath = path.join(hooksDir, scriptName);
  try {
    const stdout = execSync(`node "${scriptPath}"`, {
      encoding: 'utf8',
      input: payload === null ? '' : JSON.stringify(payload),
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function writeState(file, obj) {
  fs.writeFileSync(path.join(sessionDir, file), JSON.stringify(obj, null, 2), 'utf8');
}
function readState(file) {
  return JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'));
}
function stateExists(file) {
  return fs.existsSync(path.join(sessionDir, file));
}

function tempFile(name) {
  const p = path.join(root, name);
  tempFiles.push(p);
  return p;
}

function tempDir(name) {
  const p = path.join(root, name);
  tempDirs.push(p);
  return p;
}

function finish() {
  cleanup();
  if (state.failures > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function cleanup() {
  for (const f of tempFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* best-effort */ }
  }
  for (const d of tempDirs) {
    try { if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
  }
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

module.exports = {
  root,
  hooksDir,
  SESSION_ID,
  sessionDir,
  check,
  runHook,
  writeState,
  readState,
  stateExists,
  tempFile,
  tempDir,
  finish,
  state
};
