#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const compat = require('../scripts/codex-hooks-compat');

let failed = 0;
function check(condition, message, detail = '') {
  if (condition) console.log('  PASS ' + message);
  else {
    failed++;
    console.error('  FAIL ' + message + (detail ? ' — ' + detail : ''));
  }
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findHarnessEntries(config, runtimeDir) {
  const out = [];
  for (const [event, entries] of Object.entries(config.hooks || {})) {
    for (const entry of entries || []) {
      if (JSON.stringify(entry).toLowerCase().includes(path.resolve(runtimeDir).replace(/\\/g, '\\\\').toLowerCase()) ||
          JSON.stringify(entry).replace(/\\\\/g, '/').toLowerCase().includes(path.resolve(runtimeDir).replace(/\\/g, '/').toLowerCase())) {
        out.push({ event, entry });
      }
    }
  }
  return out;
}

console.log('\n[2al] Codex user-hook compatibility fallback (#122)...');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-hooks-compat-'));
const codexHome = path.join(root, '.codex');
fs.mkdirSync(codexHome, { recursive: true });
const hooksFile = path.join(codexHome, 'hooks.json');
const configFile = path.join(codexHome, 'config.toml');
const userHook = {
  matcher: 'Bash',
  hooks: [{
    type: 'command',
    command: 'node "/user/policy.js"',
    timeout: 7,
    statusMessage: 'User policy',
  }],
};
const original = {
  description: 'user-owned metadata',
  hooks: {
    PreToolUse: [userHook],
    Stop: [{
      hooks: [{ type: 'command', command: 'node "/user/stop.js"', timeout: 5 }],
    }],
  },
};
fs.writeFileSync(hooksFile, JSON.stringify(original, null, 4) + '\n', 'utf8');
fs.writeFileSync(configFile, 'model = "test"\n# user trust/config state\n', 'utf8');
const configBefore = fs.readFileSync(configFile, 'utf8');

try {
  const installed = compat.install({ codexHome });
  check(installed.status === 'installed' && installed.entries > 0,
    'explicit install materializes compatibility entries');
  check(installed.trustChanged === false && fs.readFileSync(configFile, 'utf8') === configBefore,
    'install never changes Codex trust/config.toml state');

  const state = compat.status({ codexHome });
  check(state.installed && state.healthy && state.exactEntriesPresent === state.expectedEntries,
    'status verifies exact installed entry hashes and runtime tree');

  const config = read(hooksFile);
  check(config.description === original.description &&
    JSON.stringify(config.hooks.PreToolUse[0]) === JSON.stringify(userHook) &&
    config.hooks.Stop.some(entry => entry.hooks?.[0]?.command === 'node "/user/stop.js"'),
    'existing unrelated user hooks and top-level metadata are preserved semantically');

  const manifest = read(path.join(codexHome, 'harness-everything', 'compat-hooks', 'manifest.json'));
  const harnessEntries = findHarnessEntries(config, manifest.runtimeDir);
  check(harnessEntries.length === manifest.entries.length,
    'every compatibility hook command resolves to the Harness-owned runtime copy');
  check(!JSON.stringify(harnessEntries).includes('${PLUGIN_ROOT}') &&
    !JSON.stringify(harnessEntries).includes('${CLAUDE_PLUGIN_ROOT}') &&
    !JSON.stringify(harnessEntries).includes('%PLUGIN_ROOT%'),
    'compatibility entries use literal absolute runtime paths without shell-specific plugin expansion');
  check(fs.existsSync(path.join(manifest.runtimeDir, 'hooks', 'scripts', 'codex-action-gate-pre.js')) &&
    fs.existsSync(path.join(manifest.runtimeDir, 'skills', 'harness-everything', 'scripts', 'kernel-router.js')),
    'compatibility runtime is self-contained for hook and router dependencies');

  const countsBefore = Object.fromEntries(Object.entries(config.hooks).map(([event, entries]) => [event, entries.length]));
  const updated = compat.install({ codexHome });
  const configAfterUpdate = read(hooksFile);
  const countsAfter = Object.fromEntries(Object.entries(configAfterUpdate.hooks).map(([event, entries]) => [event, entries.length]));
  check(updated.status === 'updated' && JSON.stringify(countsAfter) === JSON.stringify(countsBefore),
    'reinstall/update is idempotent and does not duplicate hook entries');

  configAfterUpdate.hooks.PostToolUse = configAfterUpdate.hooks.PostToolUse || [];
  const addedUserHook = { hooks: [{ type: 'command', command: 'node "/user/later.js"', timeout: 3 }] };
  configAfterUpdate.hooks.PostToolUse.unshift(addedUserHook);
  fs.writeFileSync(hooksFile, JSON.stringify(configAfterUpdate, null, 2) + '\n', 'utf8');
  compat.install({ codexHome });
  check(read(hooksFile).hooks.PostToolUse.some(entry => entry.hooks?.[0]?.command === 'node "/user/later.js"'),
    'update preserves user hooks added after the initial compatibility install');

  const beforeTamper = fs.readFileSync(hooksFile, 'utf8');
  const tampered = read(hooksFile);
  const currentManifest = read(path.join(codexHome, 'harness-everything', 'compat-hooks', 'manifest.json'));
  let changed = false;
  for (const [event, entries] of Object.entries(tampered.hooks)) {
    for (const entry of entries) {
      if (!changed && JSON.stringify(entry).replace(/\\\\/g, '/').toLowerCase()
          .includes(path.resolve(currentManifest.runtimeDir).replace(/\\/g, '/').toLowerCase())) {
        entry.hooks[0].statusMessage = 'user modified this installed Harness hook';
        changed = true;
      }
    }
  }
  fs.writeFileSync(hooksFile, JSON.stringify(tampered, null, 2) + '\n', 'utf8');
  const tamperedBytes = fs.readFileSync(hooksFile, 'utf8');
  let updateRefused = false;
  try { compat.install({ codexHome }); } catch (error) { updateRefused = /modified/.test(error.message); }
  check(updateRefused && fs.readFileSync(hooksFile, 'utf8') === tamperedBytes,
    'modified Harness compatibility entry makes update fail closed without rewriting user config');

  let uninstallRefused = false;
  try { compat.uninstall({ codexHome }); } catch (error) { uninstallRefused = /modified/.test(error.message); }
  check(uninstallRefused && fs.readFileSync(hooksFile, 'utf8') === tamperedBytes,
    'modified Harness compatibility entry makes uninstall fail closed rather than deleting user edits');

  // Restore the exact generated config by starting from the pre-tamper bytes.
  fs.writeFileSync(hooksFile, beforeTamper, 'utf8');
  compat.install({ codexHome });
  const removed = compat.uninstall({ codexHome });
  const finalConfig = read(hooksFile);
  check(removed.status === 'uninstalled' && removed.removed > 0 && removed.trustChanged === false,
    'explicit uninstall removes exact Harness-owned entries without changing trust state');
  check(finalConfig.description === original.description &&
    finalConfig.hooks.PreToolUse.some(entry => entry.hooks?.[0]?.command === 'node "/user/policy.js"') &&
    finalConfig.hooks.Stop.some(entry => entry.hooks?.[0]?.command === 'node "/user/stop.js"') &&
    finalConfig.hooks.PostToolUse.some(entry => entry.hooks?.[0]?.command === 'node "/user/later.js"'),
    'uninstall preserves unrelated pre-existing and later-added user hooks');
  check(fs.readFileSync(configFile, 'utf8') === configBefore,
    'uninstall leaves config.toml/trust state byte-identical');
  check(!fs.existsSync(path.join(codexHome, 'harness-everything', 'compat-hooks', 'manifest.json')),
    'uninstall removes Harness compatibility ownership manifest');

  const emptyHome = path.join(root, 'empty-codex');
  fs.mkdirSync(emptyHome, { recursive: true });
  compat.install({ codexHome: emptyHome });
  check(fs.existsSync(path.join(emptyHome, 'hooks.json')),
    'compatibility install can create a new hooks.json when none exists');
  compat.uninstall({ codexHome: emptyHome });
  check(!fs.existsSync(path.join(emptyHome, 'hooks.json')),
    'uninstall removes hooks.json only when Harness created it and no user entries remain');

  const duplicateHome = path.join(root, 'duplicate-codex');
  fs.mkdirSync(duplicateHome, { recursive: true });
  compat.install({ codexHome: duplicateHome });
  const duplicateConfig = read(path.join(duplicateHome, 'hooks.json'));
  duplicateConfig.hooks.PreToolUse.push(JSON.parse(JSON.stringify(duplicateConfig.hooks.PreToolUse[0])));
  fs.writeFileSync(path.join(duplicateHome, 'hooks.json'), JSON.stringify(duplicateConfig, null, 2) + '\n', 'utf8');
  const duplicateBytes = fs.readFileSync(path.join(duplicateHome, 'hooks.json'), 'utf8');
  let duplicateRefused = false;
  try { compat.uninstall({ codexHome: duplicateHome }); } catch (error) { duplicateRefused = /modified/.test(error.message); }
  check(duplicateRefused && fs.readFileSync(path.join(duplicateHome, 'hooks.json'), 'utf8') === duplicateBytes,
    'extra identical Harness hook is treated as user config drift, not silently deleted');

  const removedConfigHome = path.join(root, 'removed-config-codex');
  fs.mkdirSync(removedConfigHome, { recursive: true });
  fs.writeFileSync(path.join(removedConfigHome, 'hooks.json'), JSON.stringify(original, null, 2) + '\n', 'utf8');
  compat.install({ codexHome: removedConfigHome });
  fs.rmSync(path.join(removedConfigHome, 'hooks.json'), { force: true });
  const removedConfigResult = compat.uninstall({ codexHome: removedConfigHome });
  check(removedConfigResult.status === 'uninstalled' && !fs.existsSync(path.join(removedConfigHome, 'hooks.json')),
    'uninstall never recreates a user hooks.json that was removed after compatibility install');

  const preexistingHome = path.join(root, 'preexisting-identical-codex');
  fs.mkdirSync(preexistingHome, { recursive: true });
  const sourceHash = compat.treeHash(compat.SOURCE_PLUGIN_ROOT);
  const preexistingPaths = compat.pathsFor(preexistingHome, sourceHash);
  const preexistingEntries = compat.sourceHookEntries(preexistingPaths.runtimeDir);
  const preexistingHooks = {};
  for (const record of preexistingEntries) {
    preexistingHooks[record.event] = preexistingHooks[record.event] || [];
    preexistingHooks[record.event].push(JSON.parse(JSON.stringify(record.entry)));
  }
  fs.writeFileSync(path.join(preexistingHome, 'hooks.json'),
    JSON.stringify({ hooks: preexistingHooks }, null, 2) + '\n', 'utf8');
  const preexistingBefore = fs.readFileSync(path.join(preexistingHome, 'hooks.json'), 'utf8');
  const preexistingInstall = compat.install({ codexHome: preexistingHome });
  const preexistingManifest = read(path.join(preexistingHome, 'harness-everything', 'compat-hooks', 'manifest.json'));
  check(preexistingInstall.status === 'installed' && preexistingManifest.entries.length === 0,
    'byte-identical pre-existing user hooks are reused but never recorded as Harness-owned');
  const preexistingRemoved = compat.uninstall({ codexHome: preexistingHome });
  check(preexistingRemoved.removed === 0 &&
    fs.readFileSync(path.join(preexistingHome, 'hooks.json'), 'utf8') === preexistingBefore,
    'uninstall preserves byte-identical hooks that predated compatibility install');

  const forgedManifestHome = path.join(root, 'forged-manifest-codex');
  fs.mkdirSync(forgedManifestHome, { recursive: true });
  fs.writeFileSync(path.join(forgedManifestHome, 'hooks.json'),
    JSON.stringify({ hooks: { PreToolUse: [userHook] } }, null, 2) + '\n', 'utf8');
  compat.install({ codexHome: forgedManifestHome });
  const forgedManifestPath = path.join(
    forgedManifestHome, 'harness-everything', 'compat-hooks', 'manifest.json');
  const forgedManifest = read(forgedManifestPath);
  forgedManifest.entries.push({
    event: 'PreToolUse',
    hash: compat.entryHash(userHook),
    entry: userHook,
  });
  fs.writeFileSync(forgedManifestPath, JSON.stringify(forgedManifest, null, 2) + '\n', 'utf8');
  const forgedHooksBefore = fs.readFileSync(path.join(forgedManifestHome, 'hooks.json'), 'utf8');
  let forgedManifestRefused = false;
  try { compat.uninstall({ codexHome: forgedManifestHome }); }
  catch (error) { forgedManifestRefused = /corrupt/.test(error.message); }
  check(forgedManifestRefused &&
    fs.readFileSync(path.join(forgedManifestHome, 'hooks.json'), 'utf8') === forgedHooksBefore,
    'forged manifest ownership fails closed without deleting a user hook');

  const failedInstallHome = path.join(root, 'failed-install-codex');
  fs.mkdirSync(failedInstallHome, { recursive: true });
  const failedInstallHooks = path.join(failedInstallHome, 'hooks.json');
  fs.writeFileSync(failedInstallHooks,
    JSON.stringify({ description: 'must survive', hooks: { PreToolUse: [userHook] } }, null, 4) + '\n',
    'utf8');
  const failedInstallBefore = fs.readFileSync(failedInstallHooks, 'utf8');
  const failedManifestPath = path.join(
    failedInstallHome, 'harness-everything', 'compat-hooks', 'manifest.json');
  const realRenameSync = fs.renameSync;
  let failedInstallRefused = false;
  fs.renameSync = function injectedManifestFailure(source, destination) {
    if (path.resolve(destination) === path.resolve(failedManifestPath)) {
      throw new Error('injected manifest commit failure');
    }
    return realRenameSync(source, destination);
  };
  try { compat.install({ codexHome: failedInstallHome }); }
  catch (error) { failedInstallRefused = /injected manifest commit failure/.test(error.message); }
  finally { fs.renameSync = realRenameSync; }
  check(failedInstallRefused &&
    fs.readFileSync(failedInstallHooks, 'utf8') === failedInstallBefore &&
    !fs.existsSync(failedManifestPath),
    'failed manifest commit rolls hooks.json back byte-identically');

  const linkedOwnerHome = path.join(root, 'linked-owner-codex');
  const linkedOwnerOutside = path.join(root, 'linked-owner-outside');
  fs.mkdirSync(path.join(linkedOwnerHome, 'harness-everything'), { recursive: true });
  fs.mkdirSync(linkedOwnerOutside, { recursive: true });
  fs.symlinkSync(
    linkedOwnerOutside,
    path.join(linkedOwnerHome, 'harness-everything', 'compat-hooks'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  let linkedOwnerRefused = false;
  try { compat.install({ codexHome: linkedOwnerHome }); }
  catch (error) { linkedOwnerRefused = /linked|outside/.test(error.message); }
  check(linkedOwnerRefused && fs.readdirSync(linkedOwnerOutside).length === 0,
    'linked compatibility owner path cannot redirect writes outside Codex home');

  const malformedHome = path.join(root, 'malformed-codex');
  fs.mkdirSync(malformedHome, { recursive: true });
  const malformed = path.join(malformedHome, 'hooks.json');
  fs.writeFileSync(malformed, '{ this is not json', 'utf8');
  const malformedBefore = fs.readFileSync(malformed, 'utf8');
  let malformedRefused = false;
  try { compat.install({ codexHome: malformedHome }); } catch (_) { malformedRefused = true; }
  check(malformedRefused && fs.readFileSync(malformed, 'utf8') === malformedBefore,
    'malformed user hooks.json fails closed without replacement');

  const source = read(path.join(compat.SOURCE_PLUGIN_ROOT, 'hooks', 'hooks.json'));
  const sourceCount = Object.values(source.hooks).reduce((sum, entries) => sum + entries.length, 0);
  check(sourceCount === installed.entries,
    'fallback derives from the current packaged hook manifest instead of maintaining a second manual hook inventory');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') +
  ': #122 Codex compatibility fallback (' + failed + ' failure' + (failed === 1 ? '' : 's') + ')');
process.exit(failed === 0 ? 0 : 1);
