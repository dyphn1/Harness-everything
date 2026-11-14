#!/usr/bin/env node
'use strict';
// Opt-in installer for private, versioned CUA-S1 checkpoints and their pinned runtime.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PINNED_CUA_S1_REVISION } = require('./provider');

const PINS = Object.freeze({
  cuaS1Revision: PINNED_CUA_S1_REVISION,
  cuaS1Spec: `cua-s1 @ git+https://github.com/trycua/cua@${PINNED_CUA_S1_REVISION}#subdirectory=libs/cua-s1/python`,
  torchSpec: 'torch>=2.2,<3',
  torchIndex: 'https://download.pytorch.org/whl/cpu',
});
const STAGES = ['validity', 'intent', 'tier'];
const USAGE = 'Usage: install.js install --from <local-path|git-ssh-url> --version <id> [--dir <absolute-dir>] [--python <3.11-3.13>] [--dry-run] | activate <id> | rollback | status';

const defaultDir = () => path.resolve(process.env.HARNESS_SYSTEM_ONE_HOME
  || path.join(os.homedir(), '.agents', 'harness-everything', 'system-one'));
const versionDir = (dir, version) => path.join(path.resolve(dir), 'versions', version);
const activePath = dir => path.join(path.resolve(dir), 'active.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function validVersion(version) {
  return typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)
    && version !== '.' && version !== '..';
}
function assertVersion(version) {
  if (!validVersion(version)) throw new Error('invalid-version: use a single safe version id');
}
function parseArgs(argv) {
  const command = argv[0];
  if (!['install', 'activate', 'rollback', 'status'].includes(command)) throw new Error('usage');
  const opts = { command, dir: defaultDir() };
  let positional = null;
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (positional !== null) throw new Error('usage');
      positional = arg;
      continue;
    }
    if (seen.has(arg)) throw new Error('usage');
    seen.add(arg);
    if (arg === '--dry-run' && command === 'install') { opts.dryRun = true; continue; }
    if (!['--dir', '--python', '--from', '--version'].includes(arg)) throw new Error('usage');
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('usage');
    if (arg === '--dir') {
      if (!path.isAbsolute(value)) throw new Error('usage');
      opts.dir = path.resolve(value);
    } else if (arg === '--python' && command === 'install') opts.python = value;
    else if (arg === '--from' && command === 'install') opts.from = value;
    else if (arg === '--version' && command === 'install') opts.version = value;
    else throw new Error('usage');
  }
  if (command === 'install') {
    if (positional !== null || !opts.from || !validVersion(opts.version)) throw new Error('usage');
    if (opts.python === undefined) opts.python = null;
    if (opts.dryRun === undefined) opts.dryRun = false;
  } else if (command === 'activate') {
    if (!validVersion(positional) || seen.has('--python') || seen.has('--from') || seen.has('--version') || seen.has('--dry-run')) throw new Error('usage');
    opts.version = positional;
  } else if (positional !== null || seen.has('--python') || seen.has('--from') || seen.has('--version') || seen.has('--dry-run')) throw new Error('usage');
  return opts;
}

function supportedPython(version) {
  const match = typeof version === 'string' && /^3\.(\d+)\.\d+$/.exec(version);
  return Boolean(match) && Number(match[1]) >= 11 && Number(match[1]) <= 13;
}
function pythonCandidates(platform = process.platform) {
  return platform === 'win32'
    ? [['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11'], ['python'], ['python3']]
    : [['python3.13'], ['python3.12'], ['python3.11'], ['python3'], ['python']];
}
const venvPython = (dir, platform = process.platform) => platform === 'win32'
  ? path.join(dir, 'venv', 'Scripts', 'python.exe') : path.join(dir, 'venv', 'bin', 'python');
const VERSION_PROBE = ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'];

function exec(cmd, args, capture = false) {
  const result = spawnSync(cmd, args, { shell: false, windowsHide: true, encoding: 'utf8', stdio: capture ? 'pipe' : ['ignore', 2, 2] });
  if (result.error || result.status !== 0) throw new Error(`command-failed: ${path.basename(cmd)}`);
  return capture ? result.stdout.trim() : '';
}
function git(args) {
  const result = spawnSync('git', args, {
    shell: false, windowsHide: true, encoding: 'utf8', stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0) throw new Error('private-source-unavailable: check the SSH URL and SSH access');
}
function findPython(explicit) {
  for (const [cmd, ...pre] of explicit ? [[explicit]] : pythonCandidates()) {
    const result = spawnSync(cmd, [...pre, ...VERSION_PROBE], { shell: false, windowsHide: true, encoding: 'utf8' });
    const version = result.status === 0 ? result.stdout.trim() : null;
    if (supportedPython(version)) return { cmd, pre, version };
  }
  throw new Error(explicit ? 'python-unsupported: need Python 3.11-3.13' : 'python-not-found: install Python 3.11-3.13 or pass --python');
}

function sourceKind(source) {
  if (typeof source !== 'string' || !source) throw new Error('invalid-source: expected local path or Git SSH URL');
  if (fs.existsSync(source)) return 'local';
  if (typeof source === 'string' && source.startsWith('ssh://')) {
    let remote;
    try { remote = new URL(source); } catch { throw new Error('invalid-source: expected local path or Git SSH URL'); }
    if (!remote.hostname || remote.password || (remote.username && !/^[A-Za-z0-9._-]+$/.test(remote.username))
        || remote.search || remote.hash) throw new Error('invalid-source: expected local path or Git SSH URL');
    return 'ssh';
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) throw new Error('invalid-source: expected local path or Git SSH URL');
  if (/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(source || '')) return 'ssh';
  throw new Error('invalid-source: expected local path or Git SSH URL');
}
function checkpointSource(source, version, dir) {
  const kind = sourceKind(source);
  if (kind === 'local') return { dir: path.join(fs.realpathSync.native(source), 'models', 'cua-s1', version), cleanup() {} };
  const cacheRoot = path.join(dir, 'cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const cacheDir = fs.mkdtempSync(path.join(cacheRoot, 'source-'));
  const repo = path.join(cacheDir, 'repo');
  try {
    git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', source, repo]);
    git(['-C', repo, 'sparse-checkout', 'set', `models/cua-s1/${version}`]);
    return { dir: path.join(repo, 'models', 'cua-s1', version), cleanup() { fs.rmSync(cacheDir, { recursive: true, force: true }); } };
  } catch (error) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    throw error;
  }
}

function resolveManifestFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative)
      || path.win32.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('invalid-manifest: file paths must stay inside the checkpoint');
  }
  let current = root;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error('invalid-manifest: checkpoint files must be regular files without symlink components');
    }
  }
  return { path: current, relative: parts.join(path.sep) };
}
function readCheckpoint(dir, version) {
  assertVersion(version);
  const root = fs.realpathSync.native(dir);
  const manifestFile = resolveManifestFile(root, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile.path, 'utf8')); }
  catch { throw new Error('invalid-manifest: manifest.json is not valid JSON'); }
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'createdAt,evaluation,schemaVersion,stages,version'
      || manifest.schemaVersion !== 1 || manifest.version !== version
      || typeof manifest.createdAt !== 'string' || !manifest.stages
      || typeof manifest.stages !== 'object' || Array.isArray(manifest.stages)
      || !(manifest.evaluation === null || typeof manifest.evaluation === 'string')
      || STAGES.some(stage => !Object.hasOwn(manifest.stages, stage))
      || Object.keys(manifest.stages).some(stage => !STAGES.includes(stage))) {
    throw new Error('invalid-manifest: expected schema version 1 and validity, intent, and tier stages');
  }
  const files = new Map([['manifest.json', manifestFile]]);
  for (const stage of STAGES) {
    const record = manifest.stages[stage];
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.keys(record).sort().join(',') !== 'config,options,sha256,thresholds,weights'
        || !Array.isArray(record.options)
        || !record.options.every(option => typeof option === 'string')
        || !record.thresholds || typeof record.thresholds !== 'object' || Array.isArray(record.thresholds)
        || Object.values(record.thresholds).some(value => !Number.isFinite(value) || value < 0 || value > 1)
        || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Error(`invalid-manifest: malformed ${stage} stage`);
    }
    const weights = resolveManifestFile(root, record.weights);
    const config = resolveManifestFile(root, record.config);
    if (hash(fs.readFileSync(weights.path)) !== record.sha256) throw new Error(`checkpoint-hash-mismatch: ${stage}`);
    files.set(weights.relative, weights); files.set(config.relative, config);
  }
  if (manifest.evaluation !== null) {
    const evaluation = resolveManifestFile(root, manifest.evaluation);
    files.set(evaluation.relative, evaluation);
  }
  return { root, manifest, files: [...files.values()] };
}

function installVersion(source, version, dir = defaultDir()) {
  assertVersion(version);
  dir = path.resolve(dir);
  const resolved = checkpointSource(source, version, dir);
  try {
    const checkpoint = readCheckpoint(resolved.dir, version);
    const versions = path.join(dir, 'versions');
    fs.mkdirSync(versions, { recursive: true });
    if (fs.lstatSync(versions).isSymbolicLink()) throw new Error('invalid-install-dir: versions directory cannot be a symlink');
    const target = versionDir(dir, version);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('invalid-install-dir: version directory cannot be a symlink');
      const existing = readCheckpoint(target, version);
      const same = checkpoint.files.every(file => {
        const relative = path.relative(checkpoint.root, file.path);
        const other = path.join(existing.root, relative);
        return fs.existsSync(other) && fs.readFileSync(file.path).equals(fs.readFileSync(other));
      });
      if (!same) throw new Error(`version-conflict: ${version} is already installed with different files`);
      return { version, dir: target, status: 'already-installed' };
    }
    const staging = fs.mkdtempSync(path.join(versions, `.${version}.`));
    try {
      for (const file of checkpoint.files) {
        const relative = path.relative(checkpoint.root, file.path);
        const dest = path.join(staging, relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file.path, dest, fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(staging, target);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return { version, dir: target, status: 'installed' };
  } finally { resolved.cleanup(); }
}

function readActive(dir = defaultDir()) {
  const file = activePath(dir);
  if (!fs.existsSync(file)) return null;
  let active;
  try { active = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('invalid-active-pointer: active.json is not valid JSON'); }
  if (!active || active.schemaVersion !== 1 || !validVersion(active.version)
      || !(active.previous === null || validVersion(active.previous))
      || !path.isAbsolute(active.dir) || path.resolve(active.dir) !== versionDir(dir, active.version)
      || typeof active.activatedAt !== 'string' || !Number.isFinite(Date.parse(active.activatedAt))) {
    throw new Error('invalid-active-pointer: expected the versioned active.json contract');
  }
  return active;
}
function writeActive(dir, value) {
  fs.mkdirSync(dir, { recursive: true });
  const file = activePath(dir);
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
    throw new Error(`active-pointer-write-failed: ${error.message}`);
  }
}
function activate(version, dir = defaultDir()) {
  assertVersion(version);
  const target = versionDir(dir, version);
  readCheckpoint(target, version);
  const current = readActive(dir);
  if (current && current.version === version) return current;
  const next = {
    schemaVersion: 1, version, dir: path.resolve(target),
    previous: current ? current.version : null, activatedAt: new Date().toISOString(),
  };
  writeActive(dir, next);
  return next;
}
function rollback(dir = defaultDir()) {
  const current = readActive(dir);
  if (!current || !current.previous) throw new Error('rollback-unavailable: no previous version is recorded');
  return activate(current.previous, dir);
}
function versionStatus(dir, version) {
  if (!version) return null;
  try {
    const { manifest } = readCheckpoint(versionDir(dir, version), version);
    return { version, hashesOk: true, hashes: Object.fromEntries(STAGES.map(stage => [stage, manifest.stages[stage].sha256])) };
  } catch {
    return { version, hashesOk: false, hashes: null };
  }
}
function status(dir = defaultDir()) {
  const active = readActive(dir);
  const mode = process.env.HARNESS_SYSTEM_ONE_MODE || 'off';
  return {
    active: active ? versionStatus(dir, active.version) : null,
    previous: active ? versionStatus(dir, active.previous) : null,
    mode,
    modeHint: mode === 'live' ? 'HARNESS_SYSTEM_ONE_MODE=live' : 'Set HARNESS_SYSTEM_ONE_MODE=live to opt in to the active checkpoint.',
  };
}

function plan(opts) {
  const kind = sourceKind(opts.from);
  return {
    dir: opts.dir, version: opts.version, manifest: path.join(versionDir(opts.dir, opts.version), 'manifest.json'),
    sourceKind: kind,
    steps: [
      `copy and verify models/cua-s1/${opts.version} from ${kind} source`,
      `create venv ${path.join(opts.dir, 'venv')} with ${opts.python || 'first Python 3.11-3.13 found'}`,
      `${venvPython(opts.dir)} -m pip install --index-url ${PINS.torchIndex} "${PINS.torchSpec}"`,
      `${venvPython(opts.dir)} -m pip install "${PINS.cuaS1Spec}"`,
    ],
    modeHint: 'Set HARNESS_SYSTEM_ONE_MODE=live after review; installation does not activate the checkpoint.',
  };
}
function setupRuntime(dir, explicitPython) {
  const base = findPython(explicitPython);
  const venv = path.join(dir, 'venv'); const python = venvPython(dir);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(python)) exec(base.cmd, [...base.pre, '-m', 'venv', venv]);
  const version = exec(python, VERSION_PROBE, true);
  if (!supportedPython(version)) throw new Error(`python-unsupported: existing venv uses ${version}`);
  exec(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--index-url', PINS.torchIndex, PINS.torchSpec]);
  exec(python, ['-m', 'pip', 'install', '--disable-pip-version-check', PINS.cuaS1Spec]);
  return { python, version };
}
async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.command === 'activate') { process.stdout.write(`${JSON.stringify(activate(opts.version, opts.dir), null, 2)}\n`); return 0; }
  if (opts.command === 'rollback') { process.stdout.write(`${JSON.stringify(rollback(opts.dir), null, 2)}\n`); return 0; }
  if (opts.command === 'status') { process.stdout.write(`${JSON.stringify(status(opts.dir), null, 2)}\n`); return 0; }
  const p = plan(opts);
  if (opts.dryRun) { process.stdout.write(`${JSON.stringify({ dryRun: true, ...p }, null, 2)}\n`); return 0; }
  const installed = installVersion(opts.from, opts.version, opts.dir);
  const runtime = setupRuntime(opts.dir, opts.python);
  process.stdout.write(`${JSON.stringify({ dryRun: false, ...p, install: installed, runtime }, null, 2)}\n`);
  return 0;
}
if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    if (error.message === 'usage') { console.error(USAGE); process.exitCode = 2; return; }
    console.error(`System One install failed: ${error.message}`); process.exitCode = 1;
  });
}
module.exports = {
  PINS, STAGES, defaultDir, versionDir, activePath, validVersion, parseArgs,
  supportedPython, pythonCandidates, venvPython, exec, findPython, sourceKind,
  readCheckpoint, installVersion, readActive, writeActive, activate, rollback, status, plan, setupRuntime,
};
