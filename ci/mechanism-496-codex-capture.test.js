#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_ADAPTER = path.join(ROOT, 'hooks/scripts/codex-ledger-lesson.js');
const PACKAGED_ADAPTER = path.join(ROOT, 'plugins/harness-everything/hooks/scripts/codex-ledger-lesson.js');
const ERRORS_SYNC = path.join(ROOT, 'scripts/errors-sync.js');
const ERRORS_LOCAL = path.join(ROOT, 'scripts/errors-local.js');
const LEDGER = path.join(ROOT, '.agents/harness-everything/errors');
const E3_FILE = fs.readdirSync(LEDGER).find(file => /^E-0003-[a-z0-9-]+\.md$/.test(file));
const COMMITLINT_OUTPUT = fs.readFileSync(
  path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'),
  'utf8'
);

// E-0011: canonicalize temp root with realpathSync.native to expand Windows 8.3 short paths.
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), '496-codex-capture-')));
let serial = 0;

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function isolatedEnv(caseDir, overrides = {}) {
  const homeDir = path.join(caseDir, 'home');
  const stateHome = path.join(caseDir, 'state-home');
  const obsDir = path.join(caseDir, 'observations');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    HARNESS_STATE_HOME: stateHome,
    HARNESS_OBSERVATIONS_DIR: obsDir,
    ...overrides
  };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CODEX_PROJECT_DIR;
  delete env.HARNESS_WORKSPACE_ROOT;
  delete env.FABLE_WORKSPACE_ROOT;
  return { env, homeDir, stateHome, obsDir };
}

function newCaseWorkspace(name, { withLedger = true, envOverrides = {} } = {}) {
  const caseDir = path.join(TMP, `${name}-${++serial}`);
  const workspaceRoot = path.join(caseDir, 'workspace');
  fs.mkdirSync(path.join(workspaceRoot, '.git'), { recursive: true });
  if (withLedger) {
    const ledgerDir = path.join(workspaceRoot, '.agents/harness-everything/errors');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.copyFileSync(path.join(LEDGER, E3_FILE), path.join(ledgerDir, E3_FILE));
    const synced = spawnSync(process.execPath, [ERRORS_SYNC, '--root', workspaceRoot], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.equal(synced.status, 0, synced.stderr || 'errors-sync should succeed');
  }
  const envState = isolatedEnv(caseDir, envOverrides);
  return { caseDir, workspaceRoot, ...envState };
}

function runHook(adapterPath, payload, env) {
  return spawnSync(process.execPath, [adapterPath], {
    cwd: ROOT,
    env,
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8'
  });
}

function runCli(args, cwd, env) {
  return spawnSync(process.execPath, [ERRORS_LOCAL, ...args], {
    cwd,
    env,
    encoding: 'utf8'
  });
}

function listRecords(workspaceRoot, env, extraArgs = []) {
  const res = runCli(['list', '--json', ...extraArgs], workspaceRoot, env);
  assert.equal(res.status, 0, res.stderr || 'errors-local list should exit 0');
  return JSON.parse(res.stdout);
}

function preToolPayload(workspaceRoot, overrides = {}) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    session_id: `sess-${serial}`,
    turn_id: `turn-${serial}`,
    tool_use_id: `toolu_${serial}_pre`,
    cwd: workspaceRoot,
    permission_mode: 'default',
    tool_input: { command: 'npm test' },
    ...overrides
  };
}

function postToolPayload(workspaceRoot, overrides = {}) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    session_id: `sess-${serial}`,
    turn_id: `turn-${serial}`,
    tool_use_id: `toolu_${serial}_post`,
    cwd: workspaceRoot,
    permission_mode: 'default',
    tool_input: { command: 'git commit -m "Bad Subject"' },
    tool_response: {
      exit_code: 1,
      stdout: '',
      stderr: COMMITLINT_OUTPUT
    },
    ...overrides
  };
}

function runEndToEndA(adapterPath, label) {
  const ctx = newCaseWorkspace(`e2e-a-${label}`);
  const secretPath = path.join(ctx.homeDir, 'private-project', 'secret.txt');
  const stderrWithHome = `${COMMITLINT_OUTPUT}\nsee ${secretPath}\n`;

  const hookRes = runHook(
    adapterPath,
    postToolPayload(ctx.workspaceRoot, {
      session_id: `e2e-a-session-${label}`,
      tool_use_id: `toolu_e2e_a_${label}`,
      tool_response: {
        exit_code: 1,
        stdout: '',
        stderr: stderrWithHome
      }
    }),
    ctx.env
  );

  assert.equal(hookRes.status, 0, hookRes.stderr || 'failure hook exits 0');
  assert.equal(hookRes.stderr, '', 'failure hook stays silent on stderr');
  const out = JSON.parse(hookRes.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /Check the subject line against both rules/);

  const records = listRecords(ctx.workspaceRoot, ctx.env);
  assert.equal(records.length, 1, 'exactly one occurrence row captured');
  const row = records[0];
  assert.equal(row.kind, 'occurrence');
  assert.equal(row.host, 'codex');
  assert.equal(row.destination, 'unknown');
  assert.equal(row.commandClass, 'git');
  assert.equal(row.exitCode, 1);
  assert.ok(row.sessionKey && !row.sessionKey.includes(`e2e-a-session-${label}`), 'sessionKey is opaque');
  assert.ok(row.toolUseId && !row.toolUseId.includes(`toolu_e2e_a_${label}`), 'toolUseId is opaque');
  assert.ok(row.outputExcerpt.includes('<home>'), 'home path is redacted in outputExcerpt');
  assert.ok(!row.outputExcerpt.includes(ctx.homeDir), 'raw home path is not stored in outputExcerpt');
  assert.ok(row.matchedLedgerIds.includes('E-0003'), `matchedLedgerIds should include E-0003, got ${JSON.stringify(row.matchedLedgerIds)}`);
}

function runEndToEndB(adapterPath, label) {
  const ctx = newCaseWorkspace(`e2e-b-${label}`, { withLedger: false });
  const actionLesson = 'Run npm run build before npm test in this project';
  const failureLesson = 'Check failing test output before retrying npm test';

  const addAction = runCli(
    [
      'add',
      '--executable', 'npm',
      '--subcommand', 'test',
      '--lesson', actionLesson,
      '--destination', 'project'
    ],
    ctx.workspaceRoot,
    ctx.env
  );
  assert.equal(addAction.status, 0, addAction.stderr || 'errors-local add action exits 0');

  const preRes = runHook(
    adapterPath,
    preToolPayload(ctx.workspaceRoot, {
      session_id: `e2e-b-session-${label}`,
      tool_input: { command: 'npm test' }
    }),
    ctx.env
  );
  assert.equal(preRes.status, 0, preRes.stderr || 'PreToolUse hook exits 0');
  assert.equal(preRes.stderr, '', 'PreToolUse hook stays silent on stderr');
  assert.ok(preRes.stdout.trim(), 'PreToolUse hook emits provisional lesson context');
  const preOut = JSON.parse(preRes.stdout);
  assert.equal(preOut.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(preOut.hookSpecificOutput.additionalContext.includes(actionLesson), 'PreToolUse additionalContext contains provisional lesson text');
  assert.match(preOut.hookSpecificOutput.additionalContext, /provisional/i, 'PreToolUse additionalContext labels lesson as provisional');
  assert.doesNotMatch(preOut.hookSpecificOutput.additionalContext, /\b\d+\s*(?:times?|occurrences?|count|failures?)\b/i, 'no counts injected in PreToolUse lesson text');

  // Also verify PostToolUse Bash failure phase delivers matching provisional failure lessons.
  const addFailure = runCli(
    [
      'add',
      '--executable', 'git',
      '--subcommand', 'commit',
      '--diagnostic', 'subject-case',
      '--lesson', failureLesson,
      '--destination', 'project'
    ],
    ctx.workspaceRoot,
    ctx.env
  );
  assert.equal(addFailure.status, 0, addFailure.stderr || 'errors-local add failure exits 0');

  const postRes = runHook(
    adapterPath,
    postToolPayload(ctx.workspaceRoot, {
      session_id: `e2e-b-session-${label}`,
      tool_use_id: `toolu_e2e_b_post_${label}`
    }),
    ctx.env
  );
  assert.equal(postRes.status, 0);
  assert.equal(postRes.stderr, '');
  assert.ok(postRes.stdout.trim(), 'PostToolUse failure phase emits provisional failure lesson');
  const postOut = JSON.parse(postRes.stdout);
  assert.equal(postOut.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(postOut.hookSpecificOutput.additionalContext.includes(failureLesson), 'PostToolUse additionalContext contains provisional failure lesson text');
  assert.match(postOut.hookSpecificOutput.additionalContext, /provisional/i);
  assert.doesNotMatch(postOut.hookSpecificOutput.additionalContext, /\b\d+\s*(?:times?|occurrences?|count|failures?)\b/i);
}

test('Matrix 1: PostToolUse Bash confirmed failure captures one redacted occurrence with matchedLedgerIds', () => {
  runEndToEndA(CANONICAL_ADAPTER, 'canonical');
});

test('Matrix 1b: confirmed failure without a matched lesson still captures occurrence with empty matchedLedgerIds and nullable exitCode', () => {
  const ctx = newCaseWorkspace('unmatched-failure', { withLedger: false });
  const hookRes = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'unmatched-sess',
      tool_use_id: 'toolu_unmatched',
      tool_input: { command: 'npm test' },
      tool_response: {
        isError: true,
        stderr: 'FAIL some test assertion failed'
      }
    }),
    ctx.env
  );
  assert.equal(hookRes.status, 0);
  assert.equal(hookRes.stdout, '', 'no matched lesson means stdout stays silent');
  assert.equal(hookRes.stderr, '');

  const records = listRecords(ctx.workspaceRoot, ctx.env);
  assert.equal(records.length, 1, 'unmatched confirmed failure is still captured');
  assert.equal(records[0].host, 'codex');
  assert.equal(records[0].exitCode, null, 'exitCode is null when structured outcome has isError without integer exit code');
  assert.deepEqual(records[0].matchedLedgerIds, []);
});

test('Matrix 2: CLI-added provisional lesson is delivered on PreToolUse and PostToolUse Bash without counts', () => {
  runEndToEndB(CANONICAL_ADAPTER, 'canonical');
});

test('Matrix 3: unknown, success, masked-failure reminder, PreToolUse, and non-Bash outcomes do not capture rows', () => {
  const ctx = newCaseWorkspace('no-capture-controls');

  const unknownTextOnly = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-1',
      tool_use_id: 'toolu_unknown_str',
      tool_response: `Process exited with code 1\n${COMMITLINT_OUTPUT}`
    }),
    ctx.env
  );
  assert.equal(unknownTextOnly.status, 0);
  assert.equal(unknownTextOnly.stdout, '');

  const unknownObj = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-2',
      tool_use_id: 'toolu_unknown_obj',
      tool_response: { stderr: COMMITLINT_OUTPUT }
    }),
    ctx.env
  );
  assert.equal(unknownObj.status, 0);
  assert.equal(unknownObj.stdout, '');

  const successRes = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-3',
      tool_use_id: 'toolu_success',
      tool_response: { exit_code: 0, stdout: '', stderr: COMMITLINT_OUTPUT }
    }),
    ctx.env
  );
  assert.equal(successRes.status, 0);
  assert.equal(successRes.stdout, '');

  // Masked-failure reminder exception delivers context on compound exit 0, but is NOT a confirmed failure for capture.
  const maskedRes = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-4',
      tool_use_id: 'toolu_masked',
      tool_input: { command: 'git commit -m "Bad Subject"; echo "$?"' },
      tool_response: { exit_code: 0, stdout: COMMITLINT_OUTPUT, stderr: '' }
    }),
    ctx.env
  );
  assert.equal(maskedRes.status, 0);
  assert.ok(maskedRes.stdout.trim(), 'masked-failure reminder is still delivered');

  const preRes = runHook(
    CANONICAL_ADAPTER,
    preToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-5',
      tool_input: { command: 'git commit -m "Bad Subject"' }
    }),
    ctx.env
  );
  assert.equal(preRes.status, 0);
  assert.ok(preRes.stdout.trim(), 'PreToolUse delivers repo lesson');

  const nonBashFail = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-6',
      tool_name: 'Write',
      tool_use_id: 'toolu_write_fail'
    }),
    ctx.env
  );
  assert.equal(nonBashFail.status, 0);
  assert.equal(nonBashFail.stdout, '');

  assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 0, 'none of the negative controls created an occurrence row');

  // Positive control in the same workspace confirms the oracle reaches the store.
  const posRes = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess-pos',
      tool_use_id: 'toolu_pos_ctrl'
    }),
    ctx.env
  );
  assert.equal(posRes.status, 0);
  assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 1, 'positive control captures exactly one row');
});

test('Matrix 4a: unwritable store leaves injected context identical to today and does not throw', () => {
  const normalCtx = newCaseWorkspace('silent-normal');
  const blockedCtx = newCaseWorkspace('silent-unwritable');
  // Regular file at HARNESS_OBSERVATIONS_DIR blocks directory/store writes on all OSes.
  fs.writeFileSync(blockedCtx.obsDir, 'not-a-directory', 'utf8');

  const normalRes = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(normalCtx.workspaceRoot, {
      session_id: 'silent-session',
      tool_use_id: 'toolu_silent_1'
    }),
    normalCtx.env
  );
  const blockedRes = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(blockedCtx.workspaceRoot, {
      session_id: 'silent-session',
      tool_use_id: 'toolu_silent_1'
    }),
    blockedCtx.env
  );

  assert.equal(normalRes.status, 0);
  assert.equal(blockedRes.status, 0);
  assert.equal(normalRes.stderr, '');
  assert.equal(blockedRes.stderr, '');
  assert.ok(normalRes.stdout.trim(), 'lesson output is emitted in normal case');
  assert.equal(normalRes.stdout, blockedRes.stdout, 'stdout with capture equals stdout when store is unwritable');

  assert.equal(listRecords(normalCtx.workspaceRoot, normalCtx.env).length, 1);
  assert.equal(listRecords(blockedCtx.workspaceRoot, blockedCtx.env).length, 0);
});

test('Matrix 4b: missing local-error-source and local-errors modules leave injected context identical to today and do not throw', () => {
  const ctx = newCaseWorkspace('missing-modules');
  const minimalDir = path.join(ctx.caseDir, 'minimal-plugin');
  for (const [src, dest] of [
    ['hooks/scripts/codex-ledger-lesson.js', 'hooks/scripts/codex-ledger-lesson.js'],
    ['hooks/scripts/lib/ledger-match.js', 'hooks/scripts/lib/ledger-match.js'],
    ['hooks/scripts/lib/codex-tool-outcome.js', 'hooks/scripts/lib/codex-tool-outcome.js'],
    ['hooks/scripts/lib/harness-state.js', 'hooks/scripts/lib/harness-state.js'],
    ['scripts/lib/workspace.js', 'hooks/scripts/lib/workspace.js']
  ]) {
    const target = path.join(minimalDir, dest);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), target);
  }
  const statePath = path.join(minimalDir, 'hooks/scripts/lib/harness-state.js');
  fs.writeFileSync(
    statePath,
    fs.readFileSync(statePath, 'utf8').replace("require('../../../scripts/lib/workspace')", "require('./workspace')"),
    'utf8'
  );
  const minimalAdapter = path.join(minimalDir, 'hooks/scripts/codex-ledger-lesson.js');

  const preNormal = runHook(CANONICAL_ADAPTER, preToolPayload(ctx.workspaceRoot, {
    session_id: 'mod-pre-normal',
    tool_input: { command: 'git commit -m "Bad Subject"' }
  }), ctx.env);
  const preMinimal = runHook(minimalAdapter, preToolPayload(ctx.workspaceRoot, {
    session_id: 'mod-pre-minimal',
    tool_input: { command: 'git commit -m "Bad Subject"' }
  }), ctx.env);
  assert.equal(preMinimal.status, 0);
  assert.equal(preMinimal.stderr, '');
  assert.equal(preMinimal.stdout, preNormal.stdout, 'PreToolUse stdout identical when provisional/error modules are absent');

  const postNormal = runHook(CANONICAL_ADAPTER, postToolPayload(ctx.workspaceRoot, {
    session_id: 'mod-post-normal',
    tool_use_id: 'toolu_mod_1'
  }), ctx.env);
  const postMinimal = runHook(minimalAdapter, postToolPayload(ctx.workspaceRoot, {
    session_id: 'mod-post-minimal',
    tool_use_id: 'toolu_mod_2'
  }), ctx.env);
  assert.equal(postMinimal.status, 0);
  assert.equal(postMinimal.stderr, '');
  assert.equal(postMinimal.stdout, postNormal.stdout, 'PostToolUse stdout identical when provisional/error modules are absent');
});

test('Matrix 5: same tool_use_id or call_id is idempotent; distinct ids record two rows with matchedLedgerIds', () => {
  const ctx = newCaseWorkspace('idempotency');
  const sessionId = 'idem-session';

  const first = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: sessionId,
      tool_use_id: 'toolu_same'
    }),
    ctx.env
  );
  assert.equal(first.status, 0);
  assert.ok(first.stdout.trim(), 'first failure delivers lesson');

  const dup = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: sessionId,
      tool_use_id: 'toolu_same'
    }),
    ctx.env
  );
  assert.equal(dup.status, 0);
  assert.equal(dup.stdout, '', 'second delivery in same session is silent');
  assert.equal(dup.stderr, '');
  assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 1, 'same tool_use_id is idempotent (1 row)');

  const second = runHook(
    CANONICAL_ADAPTER,
    postToolPayload(ctx.workspaceRoot, {
      session_id: sessionId,
      tool_use_id: 'toolu_different'
    }),
    ctx.env
  );
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '', 'second distinct failure still has silent delivery');
  assert.equal(second.stderr, '');

  const afterSecond = listRecords(ctx.workspaceRoot, ctx.env);
  assert.equal(afterSecond.length, 2, 'different tool_use_id creates a second row');
  assert.ok(afterSecond[0].matchedLedgerIds.includes('E-0003'));
  assert.ok(afterSecond[1].matchedLedgerIds.includes('E-0003'), 'second silent failure still records matchedLedgerIds');

  // Also test host payloads supplying call_id instead of tool_use_id.
  const ctxCall = newCaseWorkspace('idempotency-call-id');
  const callFirst = postToolPayload(ctxCall.workspaceRoot, {
    session_id: 'call-sess',
    call_id: 'call_same'
  });
  delete callFirst.tool_use_id;
  assert.equal(runHook(CANONICAL_ADAPTER, callFirst, ctxCall.env).status, 0);
  assert.equal(runHook(CANONICAL_ADAPTER, callFirst, ctxCall.env).status, 0);
  assert.equal(listRecords(ctxCall.workspaceRoot, ctxCall.env).length, 1, 'same call_id is idempotent');

  const callSecond = postToolPayload(ctxCall.workspaceRoot, {
    session_id: 'call-sess',
    call_id: 'call_distinct'
  });
  delete callSecond.tool_use_id;
  assert.equal(runHook(CANONICAL_ADAPTER, callSecond, ctxCall.env).status, 0);
  assert.equal(listRecords(ctxCall.workspaceRoot, ctxCall.env).length, 2, 'distinct call_id creates a second row');
});

test('Matrix 6: packaged copy passes End-to-end A and End-to-end B', () => {
  assert.ok(fs.existsSync(PACKAGED_ADAPTER), 'packaged codex-ledger-lesson.js exists');
  runEndToEndA(PACKAGED_ADAPTER, 'packaged');
  runEndToEndB(PACKAGED_ADAPTER, 'packaged');
});
