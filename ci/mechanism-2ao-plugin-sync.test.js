'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createContext,
  findMarketplace,
  findPlugin,
  parseJsonOutput,
  resolveOnPath,
  sync
} = require('../scripts/plugin-sync');

const ROOT = path.resolve(__dirname, '..');

function fakeHost({ claudeInstalled = false, codexInstalled = false, claudeMarketplace = true, codexMarketplace = true, unknownClaudePluginState = false, unknownClaudeYesFlag = false, unknownClaudeJsonFlag = false, clapCodexJsonFlag = false, missingCodexPluginCommand = false } = {}) {
  const calls = [];
  const state = {
    claudeInstalled,
    codexInstalled,
    claudeMarketplace,
    codexMarketplace
  };
  const runner = (command, args) => {
    calls.push({ command, args: [...args] });
    const joined = args.join(' ');

    if (command === 'claude') {
      if (joined.includes('marketplace list --json')) {
        return { status: 0, stdout: JSON.stringify({ marketplaces: state.claudeMarketplace ? [{ name: 'harness-everything' }] : [] }), stderr: '' };
      }
      if (joined === 'plugin marketplace list') {
        return { status: 0, stdout: state.claudeMarketplace ? 'harness-everything\n' : '', stderr: '' };
      }
      if (joined.startsWith('plugin marketplace add')) {
        state.claudeMarketplace = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      if (joined.startsWith('plugin marketplace update')) return { status: 0, stdout: '', stderr: '' };
      if (joined.includes('plugin list --json')) {
        if (unknownClaudePluginState) return { status: 1, stdout: '', stderr: 'unsupported --json' };
        return { status: 0, stdout: JSON.stringify({ plugins: state.claudeInstalled ? [{ id: 'harness-everything@harness-everything' }] : [] }), stderr: '' };
      }
      if (joined === 'plugin list') {
        if (unknownClaudePluginState) return { status: 1, stdout: '', stderr: 'unsupported list' };
        return { status: 0, stdout: state.claudeInstalled ? 'harness-everything@harness-everything\n' : '', stderr: '' };
      }
      if (unknownClaudeYesFlag && joined.includes('--yes')) {
        return { status: 1, stdout: '', stderr: "error: unknown option '--yes'" };
      }
      if (unknownClaudeJsonFlag && joined.includes('--json')) {
        return { status: 1, stdout: '', stderr: "error: unknown option '--json'" };
      }
      if (joined.startsWith('plugin install') || joined.startsWith('plugin update')) {
        state.claudeInstalled = true;
        return { status: 0, stdout: '{}', stderr: '' };
      }
    }

    if (command === 'codex') {
      // clap-based CLIs reject an option they do not implement as an
      // unexpected argument, not as an unknown option. Read-only listings
      // already have their own plain-text fallback, so this models a build
      // whose mutating commands predate --json.
      if (clapCodexJsonFlag && args.includes('--json') && /^plugin (marketplace (add|upgrade)|add)\b/.test(joined)) {
        return {
          status: 2,
          stdout: '',
          stderr: "error: unexpected argument '--json' found\n\n  tip: to pass '--json' as a value, use '-- --json'\n\nUsage: codex plugin marketplace add --ref <REF> <SOURCE>"
        };
      }
      // Codex builds that ship only `codex plugin marketplace` have no plugin
      // install/list surface at all.
      if (missingCodexPluginCommand && /^plugin (list|add)\b/.test(joined)) {
        const subcommand = joined.split(' ')[1];
        return {
          status: 2,
          stdout: '',
          stderr: `error: unrecognized subcommand '${subcommand}'\n\nUsage: codex plugin [OPTIONS] <COMMAND>`
        };
      }
      if (joined.includes('marketplace list --json')) {
        return { status: 0, stdout: JSON.stringify({ marketplaces: state.codexMarketplace ? [{ name: 'harness-everything' }] : [] }), stderr: '' };
      }
      if (joined === 'plugin marketplace list') {
        return { status: 0, stdout: state.codexMarketplace ? 'harness-everything\n' : '', stderr: '' };
      }
      if (joined.startsWith('plugin marketplace add')) {
        state.codexMarketplace = true;
        return { status: 0, stdout: '{}', stderr: '' };
      }
      if (joined.startsWith('plugin marketplace upgrade')) return { status: 0, stdout: '{}', stderr: '' };
      if (joined.includes('plugin list --marketplace harness-everything --json') || joined === 'plugin list --json') {
        return { status: 0, stdout: JSON.stringify({ plugins: state.codexInstalled ? [{ name: 'harness-everything', marketplace: 'harness-everything' }] : [] }), stderr: '' };
      }
      if (joined === 'plugin list --marketplace harness-everything' || joined === 'plugin list') {
        return { status: 0, stdout: state.codexInstalled ? 'harness-everything@harness-everything\n' : '', stderr: '' };
      }
      if (joined.startsWith('plugin add')) {
        state.codexInstalled = true;
        return { status: 0, stdout: '{}', stderr: '' };
      }
    }

    return { status: 0, stdout: '', stderr: '' };
  };

  return {
    calls,
    runner,
    commandAvailable: () => true
  };
}

function callsFor(calls, command, prefix) {
  return calls.filter(call => call.command === command && call.args.join(' ').startsWith(prefix));
}

function runHost(host, fake) {
  return sync({ host, repository: 'dyphn1/Harness-everything', ref: 'main' }, {
    ...fake,
    log: () => {},
    warn: () => {}
  });
}

assert.strictEqual(parseJsonOutput('status\n{"ok":true}\n').ok, true);
assert.strictEqual(findMarketplace({ marketplaces: [{ name: 'harness-everything' }] }, 'harness-everything'), true);
assert.strictEqual(findPlugin({ plugins: [{ id: 'harness-everything@harness-everything' }] }, 'harness-everything', 'harness-everything'), true);

{
  const fake = fakeHost({ claudeInstalled: false });
  const result = runHost('claude', fake);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.results[0].action, 'install');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin install').length, 1, 'absent Claude plugin must install');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin update').length, 0, 'absent Claude plugin must not update');
}

{
  const fake = fakeHost({ claudeInstalled: true });
  const result = runHost('claude', fake);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.results[0].action, 'update');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin update').length, 1, 'installed Claude plugin must update');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin install').length, 0, 'installed Claude plugin must not reinstall');
}

{
  const fake = fakeHost({ claudeInstalled: true, unknownClaudeYesFlag: true });
  const result = runHost('claude', fake);
  const updateCalls = callsFor(fake.calls, 'claude', 'plugin update');
  assert.strictEqual(result.failed, 0, 'unsupported Claude --yes must fall back to a compatible update command');
  assert.strictEqual(result.results[0].action, 'update');
  assert.strictEqual(updateCalls.length, 2, 'unsupported --yes must cause one compatibility retry');
  assert.ok(updateCalls[0].args.includes('--yes'), 'first update attempt should use the current non-interactive flag');
  assert.ok(!updateCalls[1].args.includes('--yes'), 'compatibility retry must omit unsupported --yes');
}

{
  const fake = fakeHost({ claudeInstalled: true, unknownClaudeYesFlag: true, unknownClaudeJsonFlag: true });
  const result = runHost('claude', fake);
  const updateCalls = callsFor(fake.calls, 'claude', 'plugin update');
  assert.strictEqual(result.failed, 0, 'unsupported Claude --yes and --json must fall back to a compatible update command');
  assert.strictEqual(updateCalls.length, 3, 'each unsupported option must cause one compatibility retry');
  assert.ok(updateCalls[0].args.includes('--yes') && updateCalls[0].args.includes('--json'), 'first update attempt should use current flags');
  assert.ok(!updateCalls[1].args.includes('--yes') && updateCalls[1].args.includes('--json'), 'second attempt should omit only unsupported --yes');
  assert.ok(!updateCalls[2].args.includes('--yes') && !updateCalls[2].args.includes('--json'), 'final attempt must omit both unsupported flags');
}

{
  const fake = fakeHost({ codexInstalled: false });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.results[0].action, 'install');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin add').length, 1, 'absent Codex plugin must install');
}

{
  const fake = fakeHost({ codexInstalled: true });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.results[0].action, 'update');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin marketplace upgrade').length, 1, 'installed Codex plugin must upgrade its marketplace');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin add').length, 0, 'installed Codex plugin must not be re-added');
}

{
  const fake = fakeHost({ codexInstalled: false, codexMarketplace: false, clapCodexJsonFlag: true });
  const result = runHost('codex', fake);
  const addCalls = callsFor(fake.calls, 'codex', 'plugin marketplace add');
  const installCalls = callsFor(fake.calls, 'codex', 'plugin add');
  assert.strictEqual(result.failed, 0, 'clap-style --json rejection must fall back to a compatible Codex command');
  assert.strictEqual(result.results[0].action, 'install');
  assert.strictEqual(addCalls.length, 2, 'unsupported Codex --json must cause one marketplace add retry');
  assert.ok(addCalls[0].args.includes('--json'), 'first Codex marketplace add should use the current flags');
  assert.ok(!addCalls[1].args.includes('--json'), 'Codex compatibility retry must omit unsupported --json');
  assert.ok(installCalls.some(call => !call.args.includes('--json')), 'Codex plugin install must also retry without --json');
}

{
  const fake = fakeHost({ codexInstalled: true, clapCodexJsonFlag: true });
  const result = runHost('codex', fake);
  const upgradeCalls = callsFor(fake.calls, 'codex', 'plugin marketplace upgrade');
  assert.strictEqual(result.failed, 0, 'clap-style --json rejection must not fail the Codex upgrade path');
  assert.strictEqual(result.results[0].action, 'update');
  assert.strictEqual(upgradeCalls.length, 2, 'unsupported Codex --json must cause one upgrade retry');
  assert.ok(!upgradeCalls[1].args.includes('--json'), 'Codex upgrade retry must omit unsupported --json');
}

{
  const fake = fakeHost({ codexMarketplace: false, missingCodexPluginCommand: true, clapCodexJsonFlag: true });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 0, 'a Codex build without plugin subcommands is a capability boundary, not a failure');
  assert.strictEqual(result.skipped, 1, 'the boundary must be reported as a distinct skipped outcome');
  assert.strictEqual(result.results[0].reasonCode, 'host-capability-boundary', 'a capability boundary must not be reported as a missing CLI');
  assert.match(result.results[0].reason, /codex plugin list/, 'the skip reason must name the missing host command');
  assert.match(result.results[0].reason, /upgrade/i, 'the skip reason must stay actionable');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin marketplace add').length, 2, 'the supported marketplace registration must still run');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin add').length, 0, 'an unsupported host must not be blindly installed into');
}

{
  const fake = fakeHost({ unknownClaudePluginState: true });
  const result = runHost('claude', fake);
  assert.strictEqual(result.failed, 1, 'unknown installed state must fail closed');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin install').length, 0, 'unknown state must not install');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin update').length, 0, 'unknown state must not update blindly');
  assert.strictEqual(callsFor(fake.calls, 'claude', 'plugin marketplace update').length, 0, 'unknown state must not refresh the marketplace blindly');
}

{
  const result = sync({ host: 'all' }, { commandAvailable: () => false, log: () => {}, warn: () => {} });
  assert.strictEqual(result.skipped, 2);
  assert.strictEqual(result.failed, 0);
  assert.ok(result.results.every(entry => entry.reasonCode === 'cli-not-found'), 'an absent CLI must stay distinguishable from a capability boundary');
}

// resolveOnPath() is pure filesystem logic (platform choice happens only at
// the defaultRunner call site), so its directory-order-first contract runs
// on every CI OS, not only Windows.
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-sync-resolve-'));
  const cmdDir = path.join(base, 'cmd-dir');
  const exeDir = path.join(base, 'exe-dir');
  fs.mkdirSync(cmdDir);
  fs.mkdirSync(exeDir);
  fs.writeFileSync(path.join(cmdDir, 'harness-fixture.cmd'), '');
  fs.writeFileSync(path.join(exeDir, 'harness-fixture.exe'), '');
  try {
    // Windows filesystems match extensions case-insensitively, so compare
    // case-insensitively too: the point under test is which directory and
    // base name won, not PATHEXT's own casing convention.
    const pathExt = '.COM;.EXE;.BAT;.CMD';
    const cmdFirst = resolveOnPath('harness-fixture', { pathValue: [cmdDir, exeDir].join(path.delimiter), pathExt });
    assert.strictEqual(String(cmdFirst).toLowerCase(), path.join(cmdDir, 'harness-fixture.cmd').toLowerCase(), 'an earlier PATH directory must win even when a later one has the extension PATHEXT prefers');

    const exeFirst = resolveOnPath('harness-fixture', { pathValue: [exeDir, cmdDir].join(path.delimiter), pathExt });
    assert.strictEqual(String(exeFirst).toLowerCase(), path.join(exeDir, 'harness-fixture.exe').toLowerCase(), 'PATH order, not extension preference, must decide the match');

    const missing = resolveOnPath('harness-fixture-does-not-exist', { pathValue: [cmdDir, exeDir].join(path.delimiter), pathExt });
    assert.strictEqual(missing, null, 'an unresolved command must return null, not throw');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

if (process.platform === 'win32') {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-sync-command-'));
  const originalPath = process.env.PATH;
  try {
    fs.writeFileSync(path.join(fixtureDir, 'harness-codex-fixture.cmd'), '@echo off\r\necho codex-cli fixture\r\n');
    process.env.PATH = `${fixtureDir};${originalPath || ''}`;
    const context = createContext();
    assert.strictEqual(context.commandAvailable('harness-codex-fixture'), true, 'Windows .cmd CLI shims must be detected');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// End-to-end: when a .cmd shim sits earlier on PATH than an unrelated real
// .exe, the runner must actually execute the .cmd (not silently prefer
// whichever candidate Node's non-shell spawn can launch directly).
if (process.platform === 'win32') {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-sync-order-'));
  const shadowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-sync-shadow-'));
  const originalPath = process.env.PATH;
  try {
    fs.writeFileSync(path.join(fixtureDir, 'harness-order-fixture.cmd'), '@echo off\r\necho current-cmd-shim\r\n');
    // A real, directly-launchable PE binary standing in for an unrelated,
    // stale standalone install later on PATH. cmd.exe itself is a stable,
    // always-present .exe to copy for this purpose.
    fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), path.join(shadowDir, 'harness-order-fixture.exe'));
    process.env.PATH = [fixtureDir, shadowDir, originalPath || ''].join(path.delimiter);

    const context = createContext();
    const result = context.runner('harness-order-fixture', []);
    assert.strictEqual(result.status, 0, 'the earlier PATH entry must run successfully');
    assert.match(result.stdout, /current-cmd-shim/, 'an earlier .cmd must be executed even though a later, directly-launchable .exe also matches');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(shadowDir, { recursive: true, force: true });
  }
}

for (const wrapper of ['scripts/plugin-sync.sh', 'scripts/plugin-sync.ps1']) {
  const text = fs.readFileSync(path.join(ROOT, wrapper), 'utf8');
  assert.match(text, /plugin-sync\.js/);
  assert.doesNotMatch(text, /\.codex\/plugins\/cache|config\.toml/);
}

const cli = fs.readFileSync(path.join(ROOT, 'bin', 'cli.js'), 'utf8');
assert.match(cli, /case 'plugin-sync'/);
assert.match(cli, /Existing installations always take the update/);

console.log('Native plugin sync verified: absent plugins install, installed plugins update, and unknown state fails closed.');
