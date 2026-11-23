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
const codexHooksCompat = require('../scripts/codex-hooks-compat');
// A fake host runner does not mock the compatibility installer's filesystem
// writes. Fail closed if any case forgets to pass its explicit temporary home.
const realInstall = codexHooksCompat.install;
function isInsideTempRoot(root, target, pathApi = path) {
  const relative = pathApi.relative(root, target);
  const outside = relative === '..' || relative.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(relative);
  return relative !== '' && !outside;
}

codexHooksCompat.install = options => {
  assert(options && options.codexHome, 'tests must supply an explicit temporary Codex home');
  assert(isInsideTempRoot(os.tmpdir(), path.resolve(options.codexHome)),
    'test Codex home must be inside the temporary directory');
  return realInstall(options);
};

for (const [target, inside] of [
  ['D:\\repo', false],
  ['D:\\repo\\..cache', true],
  ['D:\\repo\\child', true],
  ['D:\\other', false],
  ['D:\\', false],
  ['C:\\temp', false],
]) {
  assert.strictEqual(isInsideTempRoot('D:\\repo', target, path.win32), inside, target);
}


function fakeHost({ claudeInstalled = false, codexInstalled = false, codexPluginSourcePath = path.join(ROOT, 'plugins', 'harness-everything'), codexPluginSourceType = 'local', codexAvailableOnly = false, claudeMarketplace = true, codexMarketplace = true, unknownClaudePluginState = false, unknownClaudeYesFlag = false, unknownClaudeJsonFlag = false, clapCodexJsonFlag = false, missingCodexPluginCommand = false, codexHooksError = null } = {}) {
  const calls = [];
  const codexHookInstalls = [];
  const state = {
    claudeInstalled,
    codexInstalled,
    claudeMarketplace,
    codexMarketplace,
    codexPluginSourcePath,
    codexAvailableOnly
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
        const source = state.codexPluginSourcePath ? {
          source: codexPluginSourceType,
          ...(codexPluginSourceType === 'git-subdir' ? { url: 'https://github.com/dyphn1/Harness-everything.git' } : {}),
          path: state.codexPluginSourcePath
        } : null;
        if (state.codexAvailableOnly) {
          return { status: 0, stdout: JSON.stringify({ installed: [], available: [{
            pluginId: 'harness-everything@harness-everything',
            name: 'harness-everything',
            marketplaceName: 'harness-everything',
            installed: false,
            source
          }] }), stderr: '' };
        }
        const plugin = state.codexInstalled ? [{ name: 'harness-everything', marketplace: 'harness-everything', ...(source ? { source } : {}) }] : [];
        return { status: 0, stdout: JSON.stringify({ plugins: plugin }), stderr: '' };
      }
      if (joined === 'plugin list --marketplace harness-everything' || joined === 'plugin list') {
        return { status: 0, stdout: state.codexInstalled ? 'harness-everything@harness-everything\n' : '', stderr: '' };
      }
      if (joined.startsWith('plugin add')) {
        state.codexInstalled = true;
        state.codexAvailableOnly = false;
        return { status: 0, stdout: '{}', stderr: '' };
      }
    }

    return { status: 0, stdout: '', stderr: '' };
  };

  return {
    calls,
    runner,
    commandAvailable: () => true,
    codexHookInstalls,
    codexHooksInstall: options => {
      codexHookInstalls.push(options);
      if (codexHooksError) throw new Error(codexHooksError);
      return { status: codexInstalled ? 'updated' : 'installed', entries: 8, trustChanged: false };
    }
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
  assert.strictEqual(fake.codexHookInstalls.length, 1, 'install must also refresh the Codex compatibility hooks');
  assert.strictEqual(result.results[0].compatHooks.status, 'installed');
}

{
  const fake = fakeHost({ codexAvailableOnly: true });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 0, 'an available-only entry must be installed and verified after its state changes');
  assert.strictEqual(result.results[0].action, 'install', 'installed:false must not make an available plugin appear installed');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin add').length, 1, 'available-only entries must take the plugin add path');
  assert.strictEqual(fake.codexHookInstalls.length, 1, 'hooks refresh only after the post-add listing verifies an installed local source');
}

{
  const fake = fakeHost({ codexInstalled: true });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.results[0].action, 'update');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin marketplace upgrade').length, 1, 'installed Codex plugin must upgrade its marketplace');
  assert.strictEqual(callsFor(fake.calls, 'codex', 'plugin add').length, 0, 'installed Codex plugin must not be re-added');
  assert.strictEqual(fake.codexHookInstalls.length, 1, 'marketplace update must refresh the copied Codex hooks');
  assert.strictEqual(result.results[0].compatHooks.status, 'updated');
}

{
  const installedSource = path.join(os.tmpdir(), 'newer-marketplace-plugin');
  const fake = fakeHost({ codexInstalled: true, codexPluginSourcePath: installedSource });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(fake.codexHookInstalls[0].sourcePluginRoot, installedSource,
    'compatibility hooks must be copied from the installed marketplace plugin, not this older package checkout');
  assert.notStrictEqual(fake.codexHookInstalls[0].sourcePluginRoot, codexHooksCompat.SOURCE_PLUGIN_ROOT);
}

{
  const fake = fakeHost({ codexInstalled: true, codexPluginSourcePath: null });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 1, 'sync must fail visibly when it cannot identify the installed plugin source');
  assert.strictEqual(fake.codexHookInstalls.length, 0, 'sync must not overwrite compatibility hooks from an unverified local package');
  assert.match(result.results[0].error, /source/i);
}

{
  const staleCheckout = path.join(ROOT, 'plugins', 'harness-everything');
  const fake = fakeHost({ codexInstalled: true, codexPluginSourcePath: staleCheckout, codexPluginSourceType: 'git-subdir' });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 1, 'a tagged git-subdir source must not be treated as a local plugin directory');
  assert.strictEqual(fake.codexHookInstalls.length, 0, 'an unsupported source variant must not copy hooks from the stale package checkout');
  assert.match(result.results[0].error, /git-subdir|source/i);
}

{
  const fake = fakeHost({
    codexInstalled: true,
    codexPluginSourcePath: 'plugins/harness-everything',
    codexPluginSourceType: 'git-subdir'
  });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 1, 'a repository-relative git-subdir path must not be resolved against the sync process CWD');
  assert.strictEqual(fake.codexHookInstalls.length, 0, 'a git-subdir URL and relative path must not be passed to the local compatibility installer');
  assert.match(result.results[0].error, /git-subdir|source/i);
}

for (const sourceType of ['git', 'npm', 'remote', 'unknown']) {
  const fake = fakeHost({ codexInstalled: true, codexPluginSourcePath: path.join(ROOT, 'plugins', 'harness-everything'), codexPluginSourceType: sourceType });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 1, `the ${sourceType} source variant must fail closed`);
  assert.strictEqual(fake.codexHookInstalls.length, 0, `the ${sourceType} source variant must not run the compatibility installer`);
}

{
  const fake = fakeHost({ codexInstalled: true, codexPluginSourcePath: 'plugins/harness-everything' });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 1, 'a relative local source path is not a verified installed plugin directory');
  assert.strictEqual(fake.codexHookInstalls.length, 0, 'a relative source path must not be copied from the sync process CWD');
  assert.match(result.results[0].error, /absolute|source/i);
}

{
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-sync-codex-home-'));
  try {
    const source = path.join(codexHome, 'plugin-cache');
    fs.cpSync(codexHooksCompat.SOURCE_PLUGIN_ROOT, source, { recursive: true });
    const fake = fakeHost({ codexInstalled: true, codexPluginSourcePath: source });
    const result = sync({ host: 'codex', codexHome }, {
      runner: fake.runner,
      commandAvailable: fake.commandAvailable,
      log: () => {},
      warn: () => {},
    });
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.results[0].compatHooks.status, 'installed');
    const state = codexHooksCompat.status({ codexHome });
    assert(state.installed && state.healthy, 'plugin-sync default path installs the actual packaged compatibility hooks');
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
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
  const fake = fakeHost({ codexInstalled: true, codexHooksError: 'user hook config drift' });
  const result = runHost('codex', fake);
  assert.strictEqual(result.failed, 1, 'a failed compatibility-hook refresh must be visible');
  assert.match(result.results[0].error, /compatibility hooks/i);
}

{
  const fake = fakeHost({ codexInstalled: true });
  const result = sync({ host: 'codex', dryRun: true }, { ...fake, log: () => {}, warn: () => {} });
  assert.strictEqual(result.results[0].compatHooks.status, 'dry-run');
  assert.strictEqual(fake.codexHookInstalls.length, 0, 'dry-run must not install or rewrite Codex hooks');
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
  assert.strictEqual(result.skipped, 3);
  assert.strictEqual(result.failed, 0);
  assert.ok(result.results.every(entry => entry.reasonCode === 'cli-not-found'), 'an absent CLI must stay distinguishable from a capability boundary');
}

{
  // Each host sync is fully synchronous and does real network I/O; without a
  // progress notice emitted before that work starts, the terminal stays
  // silent for the whole run, which is indistinguishable from a hang.
  const events = [];
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-progress-codex-'));
  const fake = fakeHost({ claudeInstalled: true, codexInstalled: true });
  const runner = (command, args, opts) => {
    events.push(`call:${command}`);
    return fake.runner(command, args, opts);
  };
  const result = sync({ host: 'all', codexHome, agyHome: codexHome, repository: 'dyphn1/Harness-everything', ref: 'main' }, {
    runner,
    codexHooksInstall: fake.codexHooksInstall,
    commandAvailable: () => true,
    log: () => {},
    warn: message => events.push(`warn:${message}`)
  });
  assert.strictEqual(result.failed, 0);
  fs.rmSync(codexHome, { recursive: true, force: true });
  assert.strictEqual(fake.codexHookInstalls.length, 1, 'progress test must mock hook installation as well as host commands');
  assert.ok(events.includes('warn:[...] claude: syncing'), 'a claude progress notice must be emitted');
  assert.ok(events.includes('warn:[...] codex: syncing'), 'a codex progress notice must be emitted');
  assert.ok(events.includes('warn:[...] agy: syncing'), 'an agy progress notice must be emitted');
  assert.ok(events.indexOf('warn:[...] claude: syncing') < events.indexOf('call:claude'), 'the claude notice must be emitted before its first host command, not buffered until the run finishes');
  assert.ok(events.indexOf('warn:[...] codex: syncing') < events.indexOf('call:codex'), 'the codex notice must be emitted before its first host command');
}

{
  const agyTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agy-sync-'));
  const target = path.join(agyTemp, 'plugins', 'harness-everything');

  // Test absent -> install
  const installResult = sync({ host: 'agy', agyTarget: target }, {
    commandAvailable: () => true,
    log: () => {},
    warn: () => {}
  });
  assert.strictEqual(installResult.failed, 0);
  assert.strictEqual(installResult.results[0].action, 'install');
  assert.ok(fs.existsSync(path.join(target, 'plugin.json')), 'plugin.json must be installed');

  // Test present -> update
  const updateResult = sync({ host: 'agy', agyTarget: target }, {
    commandAvailable: () => true,
    log: () => {},
    warn: () => {}
  });
  assert.strictEqual(updateResult.failed, 0);
  assert.strictEqual(updateResult.results[0].action, 'update');

  // Test dry-run on absent target: reports dry-run (not synchronized) and writes nothing
  const absentTarget = path.join(agyTemp, 'plugins', 'absent-dry-run');
  const absentDryLogs = [];
  const absentDryResult = sync({ host: 'agy', agyTarget: absentTarget, dryRun: true }, {
    commandAvailable: () => true,
    log: msg => absentDryLogs.push(msg),
    warn: () => {}
  });
  assert.strictEqual(absentDryResult.failed, 0);
  assert.strictEqual(absentDryResult.synchronized, 0, 'dry-run must not increment synchronized count');
  assert.strictEqual(absentDryResult.planned, 1, 'dry-run must increment planned count');
  assert.strictEqual(absentDryResult.results[0].status, 'dry-run', 'dry-run must report status=dry-run');
  assert.strictEqual(absentDryResult.results[0].action, 'install');
  assert.ok(!fs.existsSync(absentTarget), 'dry-run must not create target directory');
  assert.ok(absentDryLogs.some(log => log.includes('[dry-run] agy plugin install')), 'dry-run install log must be emitted');

  // Test dry-run on existing target: reports dry-run (not synchronized)
  const dryLogs = [];
  const dryResult = sync({ host: 'agy', agyTarget: target, dryRun: true }, {
    commandAvailable: () => true,
    log: msg => dryLogs.push(msg),
    warn: () => {}
  });
  assert.strictEqual(dryResult.failed, 0);
  assert.strictEqual(dryResult.synchronized, 0, 'dry-run update must not report synchronized');
  assert.strictEqual(dryResult.planned, 1);
  assert.strictEqual(dryResult.results[0].status, 'dry-run');
  assert.strictEqual(dryResult.results[0].action, 'update');
  assert.ok(dryLogs.some(log => log.includes('[dry-run] agy plugin update')), 'dry-run log must be emitted');

  // Test CLI exit code 0 for `--host agy --dry-run` in a repo with bare `.agents/` -> targets global ~/.gemini, never pollutes .agents/plugins/
  const bareAgentsRepo = path.join(agyTemp, 'codex-repo');
  fs.mkdirSync(path.join(bareAgentsRepo, '.agents', 'skills'), { recursive: true });
  const cliDryRun = require('child_process').spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'plugin-sync.js'), '--host', 'agy', '--dry-run', '--json'],
    {
      cwd: bareAgentsRepo,
      encoding: 'utf8',
      env: { ...process.env, HOME: agyTemp, USERPROFILE: agyTemp, PATH: '' }
    }
  );
  assert.strictEqual(cliDryRun.status, 0, `CLI --host agy --dry-run must exit 0: ${cliDryRun.stderr}`);
  const cliDryJson = JSON.parse(cliDryRun.stdout);
  assert.strictEqual(cliDryJson.results[0].status, 'dry-run', 'CLI JSON output must report status=dry-run');
  assert.strictEqual(cliDryJson.synchronized, 0);
  assert.strictEqual(cliDryJson.planned, 1);
  assert.strictEqual(
    cliDryJson.results[0].target,
    path.join(agyTemp, '.gemini', 'config', 'plugins', 'harness-everything'),
    'Fresh --host agy inside a repo with bare .agents/ must target global ~/.gemini, not .agents/plugins/'
  );
  assert.ok(
    !fs.existsSync(path.join(bareAgentsRepo, '.agents', 'plugins')),
    'Fresh --host agy must not pollute bare .agents/plugins/'
  );

  // Test real CLI `--host all --dry-run --json` discovers an existing global $HOME/.gemini/config/plugins/harness-everything
  const globalExisting = path.join(agyTemp, '.gemini', 'config', 'plugins', 'harness-everything', '.antigravity-plugin');
  fs.mkdirSync(globalExisting, { recursive: true });
  fs.writeFileSync(path.join(globalExisting, 'plugin.json'), '{"name":"harness-everything"}\n', 'utf8');
  const cliAllDryRun = require('child_process').spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'plugin-sync.js'), '--host', 'all', '--dry-run', '--json'],
    {
      cwd: bareAgentsRepo,
      encoding: 'utf8',
      env: { ...process.env, HOME: agyTemp, USERPROFILE: agyTemp, PATH: '' }
    }
  );
  assert.strictEqual(cliAllDryRun.status, 0, `CLI --host all --dry-run with existing global AGY install must exit 0: ${cliAllDryRun.stderr}`);
  const cliAllDryJson = JSON.parse(cliAllDryRun.stdout);
  const agyAllEntry = cliAllDryJson.results.find(r => r.host === 'agy');
  assert.ok(agyAllEntry, 'agy entry must be present in --host all output');
  assert.strictEqual(agyAllEntry.status, 'dry-run', 'Existing global AGY install must be discovered under real CLI --host all');
  assert.strictEqual(agyAllEntry.action, 'update', 'Existing global AGY install must take update action');
  assert.strictEqual(
    agyAllEntry.target,
    path.join(agyTemp, '.gemini', 'config', 'plugins', 'harness-everything')
  );

  fs.rmSync(agyTemp, { recursive: true, force: true });
}

// AGY sync acceptance: --host all with Codex .agents (including bare plugin.json) skips AGY
{
  const projectTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-only-'));
  fs.mkdirSync(path.join(projectTemp, '.agents', 'skills'), { recursive: true });
  const codexOnlyPluginDir = path.join(projectTemp, '.agents', 'plugins', 'harness-everything');
  fs.mkdirSync(codexOnlyPluginDir, { recursive: true });
  fs.writeFileSync(path.join(codexOnlyPluginDir, 'plugin.json'), '{"name":"harness-everything"}\n', 'utf8');

  const result = sync({ host: 'all', cwd: projectTemp, agyHome: projectTemp }, {
    commandAvailable: cmd => cmd === 'codex',
    log: () => {},
    warn: () => {},
    codexHooksInstall: () => ({ status: 'installed' })
  });

  const agyRes = result.results.find(r => r.host === 'agy');
  assert.ok(agyRes, 'agy result should be present');
  assert.strictEqual(agyRes.status, 'skipped', 'agy must be skipped when .agents/plugins lacks .antigravity-plugin/plugin.json');
  assert.strictEqual(agyRes.reasonCode, 'cli-not-found');
  assert.ok(
    !fs.existsSync(path.join(codexOnlyPluginDir, '.antigravity-plugin', 'plugin.json')),
    'No AGY manifest should be installed into Codex-only project'
  );

  fs.rmSync(projectTemp, { recursive: true, force: true });
}

// AGY sync acceptance: partial/corrupted target dir without plugin.json is replaced cleanly
{
  const partialTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agy-partial-'));
  const target = path.join(partialTemp, 'plugins', 'harness-everything');
  fs.mkdirSync(target, { recursive: true });
  const brokenMarker = path.join(target, 'corrupted-partial.tmp');
  fs.writeFileSync(brokenMarker, 'incomplete install', 'utf8');

  const repairResult = sync({ host: 'agy', agyTarget: target }, {
    commandAvailable: () => true,
    log: () => {},
    warn: () => {}
  });
  assert.strictEqual(repairResult.failed, 0, `Partial dir replacement must not fail: ${JSON.stringify(repairResult)}`);
  assert.strictEqual(repairResult.results[0].status, 'synchronized');
  assert.strictEqual(repairResult.results[0].action, 'install');
  assert.ok(!fs.existsSync(brokenMarker), 'Corrupted leftover file must be removed');
  assert.ok(fs.existsSync(path.join(target, '.antigravity-plugin', 'plugin.json')), 'Valid AGY manifest must be installed');

  fs.rmSync(partialTemp, { recursive: true, force: true });
}

// AGY sync acceptance: atomic refresh removes obsolete files
{
  const agyTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agy-update-'));
  const target = path.join(agyTemp, 'plugins', 'harness-everything');

  // Initial install
  sync({ host: 'agy', agyTarget: target }, {
    commandAvailable: () => true,
    log: () => {},
    warn: () => {}
  });
  assert.ok(fs.existsSync(path.join(target, 'plugin.json')));

  // Add an obsolete file
  const obsoleteFile = path.join(target, 'obsolete-leftover.txt');
  fs.writeFileSync(obsoleteFile, 'legacy content', 'utf8');
  assert.ok(fs.existsSync(obsoleteFile));

  // Run update
  const updateResult = sync({ host: 'agy', agyTarget: target }, {
    commandAvailable: () => true,
    log: () => {},
    warn: () => {}
  });
  assert.strictEqual(updateResult.failed, 0);
  assert.strictEqual(updateResult.results[0].action, 'update');
  assert.ok(!fs.existsSync(obsoleteFile), 'Obsolete file must be removed on atomic refresh update');

  fs.rmSync(agyTemp, { recursive: true, force: true });
}

// AGY sync acceptance: simulated copy failure leaves previous valid install intact
{
  const agyTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agy-rollback-'));
  const target = path.join(agyTemp, 'plugins', 'harness-everything');

  // Initial valid install
  sync({ host: 'agy', agyTarget: target }, {
    commandAvailable: () => true,
    log: () => {},
    warn: () => {}
  });
  assert.ok(fs.existsSync(path.join(target, 'plugin.json')));
  const markerFile = path.join(target, 'valid-install.txt');
  fs.writeFileSync(markerFile, 'pre-existing valid state', 'utf8');

  // Simulate copy failure
  const originalCpSync = fs.cpSync;
  let simulatedFailureTriggered = false;
  fs.cpSync = (src, dest, opts) => {
    if (typeof dest === 'string' && dest.includes(target) && dest.includes('.tmp')) {
      simulatedFailureTriggered = true;
      throw new Error('Simulated disk full or copy interruption');
    }
    return originalCpSync(src, dest, opts);
  };

  try {
    const failResult = sync({ host: 'agy', agyTarget: target }, {
      commandAvailable: () => true,
      log: () => {},
      warn: () => {}
    });
    assert.strictEqual(failResult.failed, 1);
    assert.strictEqual(failResult.results[0].status, 'failed');
  } finally {
    fs.cpSync = originalCpSync;
  }

  assert.ok(simulatedFailureTriggered, 'Simulated failure must have triggered');
  assert.ok(fs.existsSync(markerFile), 'Previous valid install must remain intact after copy failure');
  assert.strictEqual(fs.readFileSync(markerFile, 'utf8'), 'pre-existing valid state');

  fs.rmSync(agyTemp, { recursive: true, force: true });
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
    // Real PATHEXT is upper-case, but NTFS matches it case-insensitively
    // against lower-case fixture files; this test also runs on Linux/macOS
    // CI, whose case-sensitive filesystems would not, so the fixture extension
    // casing matches the file names exactly. The point under test is
    // directory order versus extension order, not PATHEXT's own casing.
    const pathExt = '.com;.exe;.bat;.cmd';
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
