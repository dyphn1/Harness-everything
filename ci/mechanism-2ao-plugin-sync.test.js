'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  findMarketplace,
  findPlugin,
  parseJsonOutput,
  sync
} = require('../scripts/plugin-sync');

const ROOT = path.resolve(__dirname, '..');

function fakeHost({ claudeInstalled = false, codexInstalled = false, claudeMarketplace = true, codexMarketplace = true, unknownClaudePluginState = false, unknownClaudeYesFlag = false } = {}) {
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
      if (joined.startsWith('plugin install') || joined.startsWith('plugin update')) {
        state.claudeInstalled = true;
        return { status: 0, stdout: '{}', stderr: '' };
      }
    }

    if (command === 'codex') {
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
