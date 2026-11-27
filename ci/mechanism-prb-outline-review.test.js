'use strict';

// Decoupled workspace-alias session-dir keying contract (T2-C #553):
// retains the surviving PR-B alias session-keying control (two runs per leg on both
// source and packaged hooks) without E1 pilot/provider/staged-tree/symlink-citation helpers.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LEGS = [
  {
    name: 'source',
    harnessState: path.join(ROOT, 'hooks/scripts/lib/harness-state.js'),
    statePersist: path.join(ROOT, 'hooks/scripts/state-persist.js'),
  },
  {
    name: 'packaged',
    harnessState: path.join(ROOT, 'plugins/harness-everything/hooks/scripts/lib/harness-state.js'),
    statePersist: path.join(ROOT, 'plugins/harness-everything/hooks/scripts/state-persist.js'),
  },
];
const failures = [];

function test(name, run) {
  try {
    const result = run();
    if (result && typeof result.unchecked === 'string') {
      console.log(`UNCHECKED ${name}: ${result.unchecked}`);
      return;
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function symlinkUnavailable(type) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-symlink-probe-'));
  try {
    const target = path.join(directory, 'target');
    if (type === 'dir') fs.mkdirSync(target);
    else fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(directory, 'link'), type);
    return null;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) return error.code;
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

test('explicitly unchecked controls do not also report PASS', () => {
  const output = [];
  const log = console.log;
  try {
    console.log = message => output.push(message);
    test('fixture precondition', () => ({ unchecked: 'EPERM' }));
  } finally { console.log = log; }
  assert.deepStrictEqual(output, ['UNCHECKED fixture precondition: EPERM']);
});

for (const leg of LEGS) {
  test(`legacy session-dir keying stays aligned through an aliased workspace root [${leg.name}]`, () => {
    const unavailable = symlinkUnavailable('dir');
    if (unavailable) return { unchecked: `directory symlink creation is unavailable (${unavailable})` };
    function driveAliasRootScenario() {
      const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-session-root-'));
      const aliasRoot = `${realRoot}-alias`;
      const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-session-state-'));
      const sessionId = 'prb-alias-session';
      const preload = path.join(stateHome, 'realpath-alias.js');
      fs.symlinkSync(realRoot, aliasRoot, 'dir');
      writeJson(path.join(stateHome, 'session-workspaces', `${sha(sessionId)}.json`), {
        version: 1, sessionId, workspaceRoot: aliasRoot,
      });
      fs.writeFileSync(preload, [
        "const fs=require('fs');",
        "const path=require('path');",
        'const original=fs.realpathSync;',
        'const alias=path.resolve(process.env.PRB_TEST_ALIAS_ROOT);',
        'function realpathSync(target,...args){',
        '  if(typeof target==="string"&&path.resolve(target)===alias)return alias;',
        '  return original.call(fs,target,...args);',
        '}',
        'realpathSync.native=original.native;',
        'fs.realpathSync=realpathSync;',
      ].join('\n'));

      const previousStateHome = process.env.HARNESS_STATE_HOME;
      const originalRealpathSync = fs.realpathSync;
      let aliasSessionDir;
      let canonicalSessionDir;
      try {
        process.env.HARNESS_STATE_HOME = stateHome;
        fs.realpathSync = function realpathSync(target, ...args) {
          if (typeof target === 'string' && path.resolve(target) === path.resolve(aliasRoot)) return path.resolve(aliasRoot);
          return originalRealpathSync.call(fs, target, ...args);
        };
        fs.realpathSync.native = originalRealpathSync.native;
        const { getSessionDir } = require(leg.harnessState);
        aliasSessionDir = getSessionDir(aliasRoot, sessionId);
        canonicalSessionDir = getSessionDir(realRoot, sessionId);
      } finally {
        fs.realpathSync = originalRealpathSync;
        if (previousStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
        else process.env.HARNESS_STATE_HOME = previousStateHome;
      }

      const env = {
        ...process.env,
        HARNESS_STATE_HOME: stateHome,
        HARNESS_WORKSPACE_ROOT: aliasRoot,
        PRB_TEST_ALIAS_ROOT: aliasRoot,
      };
      const runHook = payload => spawnSync(process.execPath,
        ['--require', preload, leg.statePersist], {
          cwd: aliasRoot,
          input: JSON.stringify(payload),
          encoding: 'utf8',
          env,
        });

      try {
        const legacy = runHook({
          hook_event_name: 'PostToolUse', session_id: sessionId, cwd: aliasRoot,
          tool_name: 'Bash', tool_input: { command: 'echo legacy-state-probe' },
          tool_response: { exitCode: 0, stdout: '', stderr: '' },
        });
        assert.strictEqual(legacy.status, 0, `generic PostToolUse state-persist remains fail-open: ${legacy.stderr}`);
        return {
          legacyExit: legacy.status,
          handoffInAliasSession: fs.existsSync(path.join(aliasSessionDir, 'handoff-state.json')),
          handoffInCanonicalSession: fs.existsSync(path.join(canonicalSessionDir, 'handoff-state.json')),
        };
      } finally {
        fs.rmSync(stateHome, { recursive: true, force: true });
        fs.rmSync(aliasRoot, { force: true });
        fs.rmSync(realRoot, { recursive: true, force: true });
      }
    }

    const first = driveAliasRootScenario();
    const second = driveAliasRootScenario();
    assert.deepStrictEqual(first, second, 'identical alias-root inputs must produce the same normalized state and exits');
    assert.strictEqual(first.legacyExit, 0, 'generic PostToolUse remains fail-open');
    assert.deepStrictEqual({
      handoffInAliasSession: first.handoffInAliasSession,
      handoffInCanonicalSession: first.handoffInCanonicalSession,
    }, {
      handoffInAliasSession: true,
      handoffInCanonicalSession: false,
    }, `generic handoff must stay in the bound alias session directory: ${JSON.stringify(first)}`);
  });
}

if (failures.length) {
  console.error(`\n${failures.length} PR-B workspace-alias assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll PR-B workspace-alias mechanism checks passed.');
}
