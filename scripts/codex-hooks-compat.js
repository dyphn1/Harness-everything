#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SOURCE_PLUGIN_ROOT = path.join(PACKAGE_ROOT, 'plugins', 'harness-everything');
const PACKAGE_VERSION = require(path.join(PACKAGE_ROOT, 'package.json')).version;
const MANIFEST_SCHEMA = 1;
const MANIFEST_MODE = 'codex-user-hooks-compat';
const RUNTIME_NAME_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?-([0-9a-f]{12})$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// `include` (relative paths) limits a Git-tracked source to its released file set.
function treeHash(root, include = null) {
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('refusing linked compatibility runtime: ' + root);
  }
  const rows = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        if (!include || include.has(rel)) rows.push(rel + ':' + sha256(fs.readFileSync(full)));
      }
      else if (entry.isSymbolicLink()) throw new Error('refusing linked compatibility runtime entry: ' + full);
    }
  }
  walk(root);
  return sha256(rows.join('\n'));
}

function entryHash(entry) {
  return sha256(stableJson(entry));
}

function defaultCodexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function sourcePluginVersion(sourcePluginRoot) {
  for (const manifestFile of [
    path.join(sourcePluginRoot, '.codex-plugin', 'plugin.json'),
    path.join(sourcePluginRoot, 'plugin.json')
  ]) {
    const manifest = readJsonObject(manifestFile, null);
    if (manifest && typeof manifest.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
      return manifest.version;
    }
  }
  throw new Error('installed plugin source is missing a valid plugin version: ' + sourcePluginRoot);
}

function pathsFor(codexHome, sourceHash = null, packageVersion = PACKAGE_VERSION) {
  const home = path.resolve(codexHome);
  const ownerRoot = path.join(home, 'harness-everything', 'compat-hooks');
  const runtimeId = sourceHash ? packageVersion + '-' + sourceHash.slice(0, 12) : null;
  return {
    codexHome: home,
    hooksFile: path.join(home, 'hooks.json'),
    configFile: path.join(home, 'config.toml'),
    ownerRoot,
    manifestFile: path.join(ownerRoot, 'manifest.json'),
    runtimeRoot: path.join(ownerRoot, 'runtime'),
    runtimeDir: runtimeId ? path.join(ownerRoot, 'runtime', runtimeId) : null,
  };
}

function readJsonObject(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(file + ' must contain a JSON object');
  }
  return parsed;
}

function readHooksFile(file) {
  const data = readJsonObject(file, { hooks: {} });
  if (data.hooks === undefined) data.hooks = {};
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    throw new Error(file + ' has invalid hooks object');
  }
  for (const [event, entries] of Object.entries(data.hooks)) {
    if (!Array.isArray(entries)) throw new Error(file + ' hooks.' + event + ' must be an array');
  }
  return data;
}

function samePath(left, right) {
  const normalize = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function assertOwnedPath(codexHome, target, label) {
  const home = path.resolve(codexHome);
  const resolvedTarget = path.resolve(target);
  if (!samePath(home, resolvedTarget) && !isPathInside(home, resolvedTarget)) {
    throw new Error('refusing outside Codex home ' + label + ': ' + target);
  }
  if (!fs.existsSync(home)) return;

  const realpath = fs.realpathSync.native || fs.realpathSync;
  const physicalHome = realpath(home);
  const relative = path.relative(home, resolvedTarget);
  let current = home;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('refusing linked ' + label + ': ' + current);
    }
    const physical = realpath(current);
    if (!samePath(physicalHome, physical) && !isPathInside(physicalHome, physical)) {
      throw new Error('refusing outside Codex home ' + label + ': ' + current);
    }
  }
}

function assertCompatibilityPaths(paths) {
  for (const [label, target] of [
    ['hooks file', paths.hooksFile],
    ['compatibility owner', paths.ownerRoot],
    ['compatibility manifest', paths.manifestFile],
    ['compatibility runtime root', paths.runtimeRoot],
    ['compatibility runtime', paths.runtimeDir],
  ]) {
    if (target) assertOwnedPath(paths.codexHome, target, label);
  }
}

function readManifest(file, expectedPaths = null) {
  if (!fs.existsSync(file)) return null;
  const data = readJsonObject(file, null);
  if (data.schemaVersion !== MANIFEST_SCHEMA ||
      data.package !== 'harness-everything' ||
      data.mode !== MANIFEST_MODE ||
      typeof data.packageVersion !== 'string' ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(data.packageVersion) ||
      typeof data.sourcePluginSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(data.sourcePluginSha256) ||
      typeof data.runtimeDir !== 'string' ||
      typeof data.hooksFile !== 'string' ||
      typeof data.createdHooksFile !== 'boolean' ||
      !Array.isArray(data.entries)) {
    throw new Error('refusing unknown/corrupt Harness compatibility manifest: ' + file);
  }
  if (!expectedPaths) return data;

  const expectedRuntimeDir = path.join(
    expectedPaths.runtimeRoot,
    data.packageVersion + '-' + data.sourcePluginSha256.slice(0, 12)
  );
  assertOwnedPath(expectedPaths.codexHome, data.runtimeDir, 'manifest runtime');
  if (!samePath(data.hooksFile, expectedPaths.hooksFile) ||
      !isPathInside(expectedPaths.runtimeRoot, data.runtimeDir) ||
      !samePath(data.runtimeDir, expectedRuntimeDir) ||
      !fs.existsSync(data.runtimeDir) ||
      treeHash(data.runtimeDir) !== data.sourcePluginSha256) {
    throw new Error('refusing unknown/corrupt Harness compatibility manifest: ' + file);
  }

  if (data.previousRuntimeDir != null) {
    const previous = data.previousRuntimeDir;
    const previousHash = data.previousSourcePluginSha256;
    const match = typeof previous === 'string' && RUNTIME_NAME_RE.exec(path.basename(previous));
    if (!match ||
        !samePath(path.dirname(previous), expectedPaths.runtimeRoot) ||
        (previousHash != null && (typeof previousHash !== 'string' ||
          !/^[0-9a-f]{64}$/.test(previousHash) || previousHash.slice(0, 12) !== match[1]))) {
      throw new Error('refusing corrupt previous compatibility runtime: ' + file);
    }
    assertOwnedPath(expectedPaths.codexHome, previous, 'previous runtime');
  }

  const allowed = new Map();
  for (const record of hookEntriesFrom(path.resolve(data.runtimeDir), path.resolve(data.runtimeDir))) {
    const key = record.event + '\0' + record.hash;
    if (!allowed.has(key)) allowed.set(key, []);
    allowed.get(key).push(stableJson(record.entry));
  }
  for (const record of data.entries) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        typeof record.event !== 'string' || !record.event ||
        typeof record.hash !== 'string' || !/^[0-9a-f]{64}$/.test(record.hash) ||
        !record.entry || typeof record.entry !== 'object' || Array.isArray(record.entry) ||
        entryHash(record.entry) !== record.hash) {
      throw new Error('refusing unknown/corrupt Harness compatibility manifest: ' + file);
    }
    const key = record.event + '\0' + record.hash;
    const candidates = allowed.get(key) || [];
    const serialized = stableJson(record.entry);
    const match = candidates.indexOf(serialized);
    if (match === -1) {
      throw new Error('refusing unknown/corrupt Harness compatibility manifest: ' + file);
    }
    candidates.splice(match, 1);
  }
  return data;
}

function atomicWriteFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, value);
    fs.renameSync(temp, file);
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch (_) {}
  }
}

function atomicWriteJson(file, value) {
  atomicWriteFile(file, JSON.stringify(value, null, 2) + '\n');
}

function replacePluginRoot(value, runtimeDir, windowsForm) {
  if (typeof value !== 'string') return value;
  const root = windowsForm
    ? runtimeDir.replace(/\//g, '\\')
    : runtimeDir.replace(/\\/g, '/');
  return value
    .replace(/\$\{PLUGIN_ROOT\}/g, root)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root);
}

function transformEntry(entry, runtimeDir) {
  function visit(value, key) {
    if (Array.isArray(value)) return value.map(item => visit(item, key));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    }
    if (typeof value === 'string') return replacePluginRoot(value, runtimeDir, key === 'commandWindows');
    return value;
  }
  return visit(JSON.parse(JSON.stringify(entry)), null);
}

function containsPath(entry, target) {
  const normalized = path.resolve(target).replace(/\\/g, '/').toLowerCase();
  const text = JSON.stringify(entry).replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
  return text.includes(normalized);
}

function removePriorEntries(config, prior) {
  const priorByEvent = new Map();
  for (const record of prior.entries || []) {
    if (!priorByEvent.has(record.event)) priorByEvent.set(record.event, new Map());
    const counts = priorByEvent.get(record.event);
    counts.set(record.hash, (counts.get(record.hash) || 0) + 1);
  }

  const drift = [];
  const removed = [];
  const nextHooks = { ...config.hooks };
  for (const [event, expectedCounts] of priorByEvent) {
    const remaining = new Map(expectedCounts);
    const entries = Array.isArray(nextHooks[event]) ? nextHooks[event] : [];
    const kept = [];
    for (const entry of entries) {
      const hash = entryHash(entry);
      const count = remaining.get(hash) || 0;
      if (count > 0) {
        removed.push({ event, hash });
        remaining.set(hash, count - 1);
        continue;
      }
      if (prior.runtimeDir && containsPath(entry, prior.runtimeDir)) {
        drift.push({
          event,
          hash,
          reason: expectedCounts.has(hash)
            ? 'unexpected duplicate Harness compatibility hook'
            : 'Harness compatibility hook was modified after install',
        });
      }
      kept.push(entry);
    }
    nextHooks[event] = kept;
  }
  return { config: { ...config, hooks: nextHooks }, drift, removed };
}

function hookEntriesFrom(pluginRoot, runtimeDir) {
  const sourceFile = path.join(pluginRoot, 'hooks', 'hooks.json');
  const source = readHooksFile(sourceFile);
  const records = [];
  for (const [event, entries] of Object.entries(source.hooks)) {
    for (const entry of entries) {
      const transformed = transformEntry(entry, runtimeDir);
      records.push({ event, hash: entryHash(transformed), entry: transformed });
    }
  }
  return records;
}

function sourceHookEntries(runtimeDir, sourcePluginRoot = SOURCE_PLUGIN_ROOT) {
  return hookEntriesFrom(sourcePluginRoot, runtimeDir);
}

// Filesystem integrity only: Codex hook trust and dispatch are not observable here.
function previousRuntimeHealth(manifest) {
  const runtimeDir = manifest.previousRuntimeDir;
  if (!runtimeDir) return { status: 'none', runtimeDir: null, healthy: true };
  if (!fs.existsSync(runtimeDir)) return { status: 'missing', runtimeDir, healthy: false };
  const actual = treeHash(runtimeDir);
  const intact = manifest.previousSourcePluginSha256
    ? actual === manifest.previousSourcePluginSha256
    : actual.slice(0, 12) === RUNTIME_NAME_RE.exec(path.basename(runtimeDir))[1];
  return intact
    ? { status: 'present', runtimeDir, healthy: true }
    : { status: 'modified', runtimeDir, healthy: false };
}

function ensureRuntime(runtimeDir, sourceHash, sourcePluginRoot = SOURCE_PLUGIN_ROOT, include = null) {
  if (fs.existsSync(runtimeDir)) {
    if (treeHash(runtimeDir) === sourceHash) return;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
  const temp = runtimeDir + '.tmp-' + process.pid;
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.cpSync(sourcePluginRoot, temp, {
      recursive: true,
      filter: src => !include || fs.lstatSync(src).isDirectory() ||
        include.has(path.relative(sourcePluginRoot, src).replace(/\\/g, '/')),
    });
    if (treeHash(temp) !== sourceHash) throw new Error('copied compatibility runtime hash mismatch');
    fs.renameSync(temp, runtimeDir);
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
  }
}

// Inspect the actual source rather than the installer checkout or caller CWD.
// An enclosing repository only owns this source if it tracks a plugin manifest.
// Returns the tracked file set for a Git-owned source, or null to copy the whole tree.
// Ignored files (.DS_Store, __pycache__) are excluded from the runtime instead of refusing.
function releasedSourceFiles(sourcePluginRoot, allowUnreleasedSource) {
  if (allowUnreleasedSource) return null;
  let root = fs.realpathSync(sourcePluginRoot);
  while (!fs.existsSync(path.join(root, '.git'))) {
    const parent = path.dirname(root);
    if (parent === root) return null;
    root = parent;
  }
  const sourceRelative = path.relative(root, fs.realpathSync(sourcePluginRoot)).replace(/\\/g, '/');
  let tracked = false;
  for (const manifest of ['.codex-plugin/plugin.json', 'plugin.json']) {
    const relative = path.posix.join(sourceRelative, manifest);
    const result = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', ':(literal)' + relative], {
      encoding: 'utf8',
    });
    if (result.error || ![0, 1].includes(result.status)) {
      throw new Error('refusing unverifiable Git source; use --allow-unreleased-source explicitly');
    }
    if (result.status === 0) { tracked = true; break; }
  }
  if (!tracked) return null;
  if (fs.statSync(path.join(root, '.git')).isFile()) {
    throw new Error('refusing unreleased linked Git worktree source; use --allow-unreleased-source explicitly');
  }
  const pathspec = ':(literal)' + (sourceRelative || '.');
  const result = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all',
    '--', pathspec], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || result.stdout.trim()) {
    throw new Error('refusing dirty or unverifiable Git source; use --allow-unreleased-source explicitly');
  }
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', pathspec], { encoding: 'utf8' });
  if (listed.error || listed.status !== 0) {
    throw new Error('refusing unverifiable Git source; use --allow-unreleased-source explicitly');
  }
  const prefix = sourceRelative ? sourceRelative + '/' : '';
  return new Set(listed.stdout.split('\0').filter(Boolean)
    .filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length)));
}

const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_TIMEOUT_MS = 60 * 1000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockOwner(lockDir) {
  try { return JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')); }
  catch (_) { return null; }
}

function lockOwnerIsStale(lockDir) {
  const owner = readLockOwner(lockDir);
  if (owner && owner.hostname === os.hostname() && Number.isInteger(owner.pid) && owner.pid > 0) {
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return error.code === 'ESRCH'; }
  }
  // Unknown or foreign-host owner (or owner.json not yet written): only age proves abandonment.
  try { return Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS; }
  catch (_) { return false; }
}

// Serializes read-manifest → prepare runtime → commit hooks/manifest → collect runtimes
// across processes, so one installer's GC cannot delete another installer's runtime.
// mkdir is atomic on every supported platform.
function withOwnerLock(paths, options, fn) {
  const lockDir = paths.ownerRoot + '.lock';
  assertOwnedPath(paths.codexHome, lockDir, 'compatibility lock');
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const timeoutMs = Number.isFinite(options.lockTimeoutMs) ? options.lockTimeoutMs : LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      // Windows can report EPERM while a released lock directory is still being deleted.
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
    }
    if (lockOwnerIsStale(lockDir)) {
      const stale = lockDir + '.stale-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
      try {
        fs.renameSync(lockDir, stale);
        // Another waiter may have broken the stale lock and re-acquired it first; give it back.
        if (!lockOwnerIsStale(stale) && !fs.existsSync(lockDir)) fs.renameSync(stale, lockDir);
        else fs.rmSync(stale, { recursive: true, force: true });
      } catch (_) {}
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for Harness compatibility lock ' + lockDir +
        '; remove it only if no Harness codex-hooks install/uninstall is running');
    }
    sleepSync(25 + Math.floor(Math.random() * 50));
  }
  try {
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
    }));
    return fn();
  } finally {
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function collectRuntimes(paths, keep) {
  if (!fs.existsSync(paths.runtimeRoot)) return;
  for (const name of fs.readdirSync(paths.runtimeRoot)) {
    // Only fingerprinted runtime directories belong to this installer.
    if (!RUNTIME_NAME_RE.test(name)) continue;
    const runtime = path.join(paths.runtimeRoot, name);
    if (keep.some(retained => retained && samePath(runtime, retained))) continue;
    assertOwnedPath(paths.codexHome, runtime, 'retired runtime');
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}

function install(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome(options.env));
  const sourcePluginRoot = path.resolve(options.sourcePluginRoot || SOURCE_PLUGIN_ROOT);
  const include = releasedSourceFiles(sourcePluginRoot, options.allowUnreleasedSource);
  const packageVersion = sourcePluginVersion(sourcePluginRoot);
  const sourceHash = treeHash(sourcePluginRoot, include);
  const p = pathsFor(codexHome, sourceHash, packageVersion);
  assertCompatibilityPaths(p);
  return withOwnerLock(p, options, () => installLocked(p, {
    codexHome, sourcePluginRoot, include, packageVersion, sourceHash,
    onRuntimeReady: options.onRuntimeReady,
  }));
}

// Every manifest read and runtime/hooks write happens inside the owner lock.
function installLocked(p, { codexHome, sourcePluginRoot, include, packageVersion, sourceHash, onRuntimeReady }) {
  const existedBefore = fs.existsSync(p.hooksFile);
  const hooksBefore = existedBefore ? fs.readFileSync(p.hooksFile) : null;
  const runtimeExistedBefore = fs.existsSync(p.runtimeDir);
  const config = readHooksFile(p.hooksFile);
  const prior = readManifest(p.manifestFile, p);

  let base = config;
  if (prior) {
    const removal = removePriorEntries(config, prior);
    if (removal.drift.length) {
      throw new Error('refusing to update: installed Harness compatibility hooks were modified; restore or uninstall them manually first');
    }
    base = removal.config;
  }

  ensureRuntime(p.runtimeDir, sourceHash, sourcePluginRoot, include);
  // Test seam: lets regressions force two installers to overlap before commit.
  if (typeof onRuntimeReady === 'function') onRuntimeReady(p.runtimeDir);
  assertCompatibilityPaths(p);
  const generated = sourceHookEntries(p.runtimeDir, sourcePluginRoot);
  const ownedEntries = [];
  const next = { ...base, hooks: { ...base.hooks } };
  for (const record of generated) {
    const list = Array.isArray(next.hooks[record.event]) ? [...next.hooks[record.event]] : [];
    if (!list.some(entry => entryHash(entry) === record.hash)) {
      list.push(record.entry);
      ownedEntries.push(record);
    }
    next.hooks[record.event] = list;
  }

  // A lost or modified previous runtime cannot be restored; drop it so status recovers.
  let previous = null;
  if (prior && !samePath(prior.runtimeDir, p.runtimeDir)) {
    previous = { runtimeDir: prior.runtimeDir, sourcePluginSha256: prior.sourcePluginSha256 };
  } else if (prior && previousRuntimeHealth(prior).status === 'present') {
    previous = { runtimeDir: prior.previousRuntimeDir, sourcePluginSha256: prior.previousSourcePluginSha256 || null };
  }
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    package: 'harness-everything',
    mode: MANIFEST_MODE,
    packageVersion,
    sourcePluginSha256: sourceHash,
    runtimeDir: p.runtimeDir,
    previousRuntimeDir: previous ? previous.runtimeDir : null,
    previousSourcePluginSha256: previous ? previous.sourcePluginSha256 : null,
    hooksFile: p.hooksFile,
    createdHooksFile: prior ? Boolean(prior.createdHooksFile) : !existedBefore,
    installedAt: new Date().toISOString(),
    entries: ownedEntries.map(({ event, hash, entry }) => ({ event, hash, entry })),
  };
  try {
    assertCompatibilityPaths(p);
    atomicWriteJson(p.hooksFile, next);
    atomicWriteJson(p.manifestFile, manifest);
  } catch (error) {
    try {
      if (hooksBefore === null) fs.rmSync(p.hooksFile, { force: true });
      else atomicWriteFile(p.hooksFile, hooksBefore);
    } catch (rollbackError) {
      error.message += '; hooks.json rollback also failed: ' + rollbackError.message;
    }
    if (!runtimeExistedBefore) {
      try { fs.rmSync(p.runtimeDir, { recursive: true, force: true }); } catch (_) {}
    }
    throw error;
  }

  collectRuntimes(p, [manifest.runtimeDir, manifest.previousRuntimeDir]);

  return {
    status: prior ? 'updated' : 'installed',
    codexHome,
    hooksFile: p.hooksFile,
    runtimeDir: p.runtimeDir,
    packageVersion,
    sourcePluginSha256: sourceHash,
    entries: generated.length,
    trustChanged: false,
  };
}

function uninstall(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome(options.env));
  const p = pathsFor(codexHome);
  assertCompatibilityPaths(p);
  const notInstalled = { status: 'not-installed', codexHome, removed: 0, trustChanged: false };
  // Avoid creating lock directories in a Codex home that was never installed.
  if (!fs.existsSync(p.manifestFile)) return notInstalled;
  const result = withOwnerLock(p, options, () => uninstallLocked(p, codexHome) || notInstalled);
  try { fs.rmdirSync(path.dirname(p.ownerRoot)); } catch (_) {}
  return result;
}

function uninstallLocked(p, codexHome) {
  const prior = readManifest(p.manifestFile, p);
  if (!prior) return null;

  const hooksFileExists = fs.existsSync(p.hooksFile);
  const config = readHooksFile(p.hooksFile);
  const removal = removePriorEntries(config, prior);
  if (removal.drift.length) {
    throw new Error('refusing to uninstall modified Harness compatibility hooks; no user config was changed');
  }

  const remainingHooks = Object.fromEntries(
    Object.entries(removal.config.hooks)
      .map(([event, entries]) => [event, entries])
      .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
  );
  const next = { ...removal.config, hooks: remainingHooks };
  const otherTopLevelKeys = Object.keys(next).filter(key => key !== 'hooks');

  if (!hooksFileExists) {
    // The user or host already removed the config. Uninstall must not recreate it.
  } else if (prior.createdHooksFile && otherTopLevelKeys.length === 0 && Object.keys(remainingHooks).length === 0) {
    fs.rmSync(p.hooksFile, { force: true });
  } else {
    atomicWriteJson(p.hooksFile, next);
  }

  collectRuntimes(p, []);
  fs.rmSync(p.manifestFile, { force: true });
  try { fs.rmdirSync(p.runtimeRoot); } catch (_) {}
  try { fs.rmdirSync(p.ownerRoot); } catch (_) {}

  return {
    status: 'uninstalled',
    codexHome,
    removed: removal.removed.length,
    trustChanged: false,
  };
}

function status(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome(options.env));
  const p = pathsFor(codexHome);
  assertCompatibilityPaths(p);
  const prior = readManifest(p.manifestFile, p);
  if (!prior) return { installed: false, codexHome, hooksFile: p.hooksFile, trustChanged: false,
    observationCapture: { status: 'inactive', reason: 'compatibility-hooks-not-installed', trustRequired: true } };
  const config = readHooksFile(p.hooksFile);
  const removal = removePriorEntries(config, prior);
  const expected = prior.entries.length;
  const currentHealthy = fs.existsSync(prior.runtimeDir) && treeHash(prior.runtimeDir) === prior.sourcePluginSha256;
  const previousRuntime = previousRuntimeHealth(prior);
  const entriesHealthy = removal.removed.length === expected && removal.drift.length === 0;
  const healthy = entriesHealthy && currentHealthy && previousRuntime.healthy;
  const reason = healthy ? 'codex-hook-trust-state-is-not-readable-here'
    : !entriesHealthy || !currentHealthy ? 'compatibility-hooks-unhealthy'
      : 'previous-runtime-' + previousRuntime.status;
  return {
    installed: true,
    codexHome,
    hooksFile: p.hooksFile,
    runtimeDir: prior.runtimeDir,
    runtimes: {
      current: { status: currentHealthy ? 'present' : 'missing-or-modified', runtimeDir: prior.runtimeDir, healthy: currentHealthy },
      previous: previousRuntime,
    },
    packageVersion: prior.packageVersion,
    sourcePluginSha256: prior.sourcePluginSha256,
    expectedEntries: expected,
    exactEntriesPresent: removal.removed.length,
    drift: removal.drift,
    healthy,
    observationCapture: {
      // A lost previous runtime breaks older sessions, not new-session capture.
      status: entriesHealthy && currentHealthy ? 'configured-unverified' : 'inactive',
      reason,
      trustRequired: true,
    },
    trustChanged: false,
  };
}

function parseArgs(argv) {
  const action = argv[0] || 'status';
  if (!['install', 'uninstall', 'status'].includes(action)) {
    throw new Error('Usage: harness codex-hooks <install|uninstall|status> [--codex-home <path>] [--allow-unreleased-source]');
  }
  let codexHome;
  let allowUnreleasedSource = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--codex-home') codexHome = path.resolve(argv[++i]);
    else if (argv[i] === '--allow-unreleased-source') allowUnreleasedSource = true;
    else throw new Error('unknown argument: ' + argv[i]);
  }
  return { action, codexHome, allowUnreleasedSource };
}

function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) {
    console.error('[Codex Hooks Compatibility] ' + error.message);
    return 2;
  }

  try {
    const result = args.action === 'install'
      ? install({ codexHome: args.codexHome, allowUnreleasedSource: args.allowUnreleasedSource })
      : args.action === 'uninstall'
        ? uninstall({ codexHome: args.codexHome })
        : status({ codexHome: args.codexHome });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (args.action === 'status' && result.installed && !result.healthy) return 1;
    return 0;
  } catch (error) {
    console.error('[Codex Hooks Compatibility] ' + error.message);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  MANIFEST_MODE,
  MANIFEST_SCHEMA,
  SOURCE_PLUGIN_ROOT,
  defaultCodexHome,
  entryHash,
  install,
  main,
  pathsFor,
  readHooksFile,
  sourcePluginVersion,
  removePriorEntries,
  sourceHookEntries,
  stableJson,
  status,
  transformEntry,
  treeHash,
  uninstall,
};
