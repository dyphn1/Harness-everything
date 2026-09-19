#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SOURCE_PLUGIN_ROOT = path.join(PACKAGE_ROOT, 'plugins', 'harness-everything');
const PACKAGE_VERSION = require(path.join(PACKAGE_ROOT, 'package.json')).version;
const MANIFEST_SCHEMA = 1;
const MANIFEST_MODE = 'codex-user-hooks-compat';

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

function treeHash(root) {
  const rows = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) rows.push(rel + ':' + sha256(fs.readFileSync(full)));
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

function pathsFor(codexHome, sourceHash = null) {
  const home = path.resolve(codexHome);
  const ownerRoot = path.join(home, 'harness-everything', 'compat-hooks');
  const runtimeId = sourceHash ? PACKAGE_VERSION + '-' + sourceHash.slice(0, 12) : null;
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

function readManifest(file) {
  if (!fs.existsSync(file)) return null;
  const data = readJsonObject(file, null);
  if (data.schemaVersion !== MANIFEST_SCHEMA ||
      data.package !== 'harness-everything' ||
      data.mode !== MANIFEST_MODE ||
      !Array.isArray(data.entries)) {
    throw new Error('refusing unknown/corrupt Harness compatibility manifest: ' + file);
  }
  return data;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, file);
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch (_) {}
  }
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

function sourceHookEntries(runtimeDir) {
  const sourceFile = path.join(SOURCE_PLUGIN_ROOT, 'hooks', 'hooks.json');
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

function ensureRuntime(runtimeDir, sourceHash) {
  if (fs.existsSync(runtimeDir)) {
    if (treeHash(runtimeDir) === sourceHash) return;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
  const temp = runtimeDir + '.tmp-' + process.pid;
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.cpSync(SOURCE_PLUGIN_ROOT, temp, { recursive: true });
    if (treeHash(temp) !== sourceHash) throw new Error('copied compatibility runtime hash mismatch');
    fs.renameSync(temp, runtimeDir);
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
  }
}

function install(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome(options.env));
  const sourceHash = treeHash(SOURCE_PLUGIN_ROOT);
  const p = pathsFor(codexHome, sourceHash);
  const existedBefore = fs.existsSync(p.hooksFile);
  const config = readHooksFile(p.hooksFile);
  const prior = readManifest(p.manifestFile);

  let base = config;
  if (prior) {
    const removal = removePriorEntries(config, prior);
    if (removal.drift.length) {
      throw new Error('refusing to update: installed Harness compatibility hooks were modified; restore or uninstall them manually first');
    }
    base = removal.config;
  }

  ensureRuntime(p.runtimeDir, sourceHash);
  const generated = sourceHookEntries(p.runtimeDir);
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

  atomicWriteJson(p.hooksFile, next);
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    package: 'harness-everything',
    mode: MANIFEST_MODE,
    packageVersion: PACKAGE_VERSION,
    sourcePluginSha256: sourceHash,
    runtimeDir: p.runtimeDir,
    hooksFile: p.hooksFile,
    createdHooksFile: prior ? Boolean(prior.createdHooksFile) : !existedBefore,
    installedAt: new Date().toISOString(),
    entries: ownedEntries.map(({ event, hash, entry }) => ({ event, hash, entry })),
  };
  atomicWriteJson(p.manifestFile, manifest);

  if (prior && prior.runtimeDir && path.resolve(prior.runtimeDir) !== path.resolve(p.runtimeDir)) {
    const ownedRoot = path.resolve(p.runtimeRoot) + path.sep;
    const oldRuntime = path.resolve(prior.runtimeDir);
    if (oldRuntime.startsWith(ownedRoot)) fs.rmSync(oldRuntime, { recursive: true, force: true });
  }

  return {
    status: prior ? 'updated' : 'installed',
    codexHome,
    hooksFile: p.hooksFile,
    runtimeDir: p.runtimeDir,
    entries: generated.length,
    trustChanged: false,
  };
}

function uninstall(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome(options.env));
  const p = pathsFor(codexHome);
  const prior = readManifest(p.manifestFile);
  if (!prior) return { status: 'not-installed', codexHome, removed: 0, trustChanged: false };

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

  if (prior.runtimeDir) {
    const ownedRoot = path.resolve(p.runtimeRoot) + path.sep;
    const runtime = path.resolve(prior.runtimeDir);
    if (runtime.startsWith(ownedRoot)) fs.rmSync(runtime, { recursive: true, force: true });
  }
  fs.rmSync(p.manifestFile, { force: true });
  try { fs.rmdirSync(p.runtimeRoot); } catch (_) {}
  try { fs.rmdirSync(p.ownerRoot); } catch (_) {}
  try { fs.rmdirSync(path.dirname(p.ownerRoot)); } catch (_) {}

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
  const prior = readManifest(p.manifestFile);
  if (!prior) return { installed: false, codexHome, hooksFile: p.hooksFile, trustChanged: false };
  const config = readHooksFile(p.hooksFile);
  const removal = removePriorEntries(config, prior);
  const expected = prior.entries.length;
  return {
    installed: true,
    codexHome,
    hooksFile: p.hooksFile,
    runtimeDir: prior.runtimeDir,
    packageVersion: prior.packageVersion,
    sourcePluginSha256: prior.sourcePluginSha256,
    expectedEntries: expected,
    exactEntriesPresent: removal.removed.length,
    drift: removal.drift,
    healthy: removal.removed.length === expected && removal.drift.length === 0 &&
      fs.existsSync(prior.runtimeDir) && treeHash(prior.runtimeDir) === prior.sourcePluginSha256,
    trustChanged: false,
  };
}

function parseArgs(argv) {
  const action = argv[0] || 'status';
  if (!['install', 'uninstall', 'status'].includes(action)) {
    throw new Error('Usage: harness codex-hooks <install|uninstall|status> [--codex-home <path>]');
  }
  let codexHome;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--codex-home') codexHome = path.resolve(argv[++i]);
    else throw new Error('unknown argument: ' + argv[i]);
  }
  return { action, codexHome };
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
      ? install({ codexHome: args.codexHome })
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
  removePriorEntries,
  sourceHookEntries,
  stableJson,
  status,
  transformEntry,
  treeHash,
  uninstall,
};
