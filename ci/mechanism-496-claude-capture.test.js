#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_ADAPTER = path.join(ROOT, 'hooks/scripts/ledger-lesson.js');
const PACKAGED_ADAPTER = path.join(ROOT, 'plugins/harness-everything/hooks/scripts/ledger-lesson.js');
const ERRORS_SYNC = path.join(ROOT, 'scripts/errors-sync.js');
const ERRORS_LOCAL = path.join(ROOT, 'scripts/errors-local.js');
const LEDGER = path.join(ROOT, '.agents/harness-everything/errors');
const E3_FILE = fs.readdirSync(LEDGER).find(file => /^E-0003-[a-z0-9-]+\.md$/.test(file));
const COMMITLINT_OUTPUT = fs.readFileSync(
  path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'),
  'utf8'
);

// E-0011: canonicalize temp root with realpathSync.native to expand Windows 8.3 short paths.
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), '496-claude-capture-')));
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
  fs.mkdirSync(workspaceRoot, { recursive: true });
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

function failurePayload(workspaceRoot, overrides = {}) {
  return {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    session_id: `sess-${serial}`,
    tool_use_id: `toolu_${serial}_1`,
    cwd: workspaceRoot,
    tool_input: { command: 'git commit -m "Bad Subject"' },
    error: COMMITLINT_OUTPUT,
    ...overrides
  };
}

function preToolPayload(workspaceRoot, overrides = {}) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    session_id: `sess-${serial}`,
    tool_use_id: `toolu_${serial}_pre`,
    cwd: workspaceRoot,
    tool_input: { command: 'npm test' },
    ...overrides
  };
}

function runEndToEndA(adapterPath, label) {
  const ctx = newCaseWorkspace(`e2e-a-${label}`);
  const secretPath = path.join(ctx.homeDir, 'private-project', 'secret.txt');
  const errorWithHome = `${COMMITLINT_OUTPUT}\nsee ${secretPath}\n`;

  const hookRes = runHook(
    adapterPath,
    failurePayload(ctx.workspaceRoot, {
      session_id: `e2e-a-session-${label}`,
      tool_use_id: `toolu_e2e_a_${label}`,
      exit_code: 1,
      error: errorWithHome
    }),
    ctx.env
  );

  assert.equal(hookRes.status, 0, hookRes.stderr || 'failure hook exits 0');
  assert.equal(hookRes.stderr, '', 'failure hook stays silent on stderr');
  const out = JSON.parse(hookRes.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.match(out.hookSpecificOutput.additionalContext, /Check the subject line against both rules/);

  const records = listRecords(ctx.workspaceRoot, ctx.env);
  assert.equal(records.length, 1, 'exactly one occurrence row captured');
  const row = records[0];
  assert.equal(row.kind, 'occurrence');
  assert.equal(row.host, 'claude');
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
  const lessonText = 'Run npm run build before npm test in this project';

  const addRes = runCli(
    [
      'add',
      '--executable', 'npm',
      '--subcommand', 'test',
      '--lesson', lessonText,
      '--destination', 'project'
    ],
    ctx.workspaceRoot,
    ctx.env
  );
  assert.equal(addRes.status, 0, addRes.stderr || 'errors-local add exits 0');

  const hookRes = runHook(
    adapterPath,
    preToolPayload(ctx.workspaceRoot, {
      session_id: `e2e-b-session-${label}`,
      tool_input: { command: 'npm test' }
    }),
    ctx.env
  );
  assert.equal(hookRes.status, 0, hookRes.stderr || 'PreToolUse hook exits 0');
  assert.equal(hookRes.stderr, '', 'PreToolUse hook stays silent on stderr');
  assert.ok(hookRes.stdout.trim(), 'PreToolUse hook emits provisional lesson context');
  const out = JSON.parse(hookRes.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  const text = out.hookSpecificOutput.additionalContext;
  assert.ok(text.includes(lessonText), 'additionalContext contains provisional lesson text');
  assert.match(text, /provisional/i, 'additionalContext labels lesson as provisional');
  assert.doesNotMatch(text, /\b\d+\s*(?:times?|occurrences?|count|failures?)\b/i, 'no counts injected in lesson text');
}

test('Row 1 (End-to-end A): PostToolUseFailure Bash captures one redacted occurrence with matchedLedgerIds', () => {
  runEndToEndA(CANONICAL_ADAPTER, 'canonical');
});

test('Row 2 (End-to-end B): CLI-added provisional lesson is delivered on next PreToolUse Bash without counts', () => {
  runEndToEndB(CANONICAL_ADAPTER, 'canonical');
});

test('Row 3 & Row 6: capture is silent and unwritable store leaves lesson stdout and exit 0 unchanged', () => {
  const normalCtx = newCaseWorkspace('silent-normal');
  const blockedCtx = newCaseWorkspace('silent-unwritable');
  // Create a regular file at HARNESS_OBSERVATIONS_DIR so store writes fail on all OSes (POSIX + Windows).
  fs.writeFileSync(blockedCtx.obsDir, 'not-a-directory', 'utf8');

  const normalRes = runHook(
    CANONICAL_ADAPTER,
    failurePayload(normalCtx.workspaceRoot, {
      session_id: 'silent-session',
      tool_use_id: 'toolu_silent_1'
    }),
    normalCtx.env
  );
  const blockedRes = runHook(
    CANONICAL_ADAPTER,
    failurePayload(blockedCtx.workspaceRoot, {
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

  // Positive control: normal case did capture a row, while blocked case could not.
  assert.equal(listRecords(normalCtx.workspaceRoot, normalCtx.env).length, 1);
  assert.equal(listRecords(blockedCtx.workspaceRoot, blockedCtx.env).length, 0);
});

test('Row 4: same tool_use_id is idempotent; different tool_use_id records second row with matchedLedgerIds even when delivery is silent', () => {
  const ctx = newCaseWorkspace('idempotency');
  const sessionId = 'idem-session';

  // First failure: delivers lesson AND captures occurrence.
  const first = runHook(
    CANONICAL_ADAPTER,
    failurePayload(ctx.workspaceRoot, {
      session_id: sessionId,
      tool_use_id: 'toolu_same'
    }),
    ctx.env
  );
  assert.equal(first.status, 0);
  assert.ok(first.stdout.trim(), 'first failure delivers lesson');

  // Duplicate with same tool_use_id: delivery is silent, store stays at 1 row.
  const dup = runHook(
    CANONICAL_ADAPTER,
    failurePayload(ctx.workspaceRoot, {
      session_id: sessionId,
      tool_use_id: 'toolu_same'
    }),
    ctx.env
  );
  assert.equal(dup.status, 0);
  assert.equal(dup.stdout, '', 'second delivery in same session is silent');
  assert.equal(dup.stderr, '');

  const afterDup = listRecords(ctx.workspaceRoot, ctx.env);
  assert.equal(afterDup.length, 1, 'same tool_use_id is idempotent (1 row)');

  // Second failure with different tool_use_id: delivery is silent, but a 2nd row is captured with matchedLedgerIds.
  const second = runHook(
    CANONICAL_ADAPTER,
    failurePayload(ctx.workspaceRoot, {
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
  assert.equal(afterSecond[0].exitCode, null, 'nullable exitCode stays null when payload has no integer exit code');
  assert.equal(afterSecond[1].exitCode, null);
  assert.ok(afterSecond[0].matchedLedgerIds.includes('E-0003'));
  assert.ok(afterSecond[1].matchedLedgerIds.includes('E-0003'), 'second silent failure still records matchedLedgerIds');
});

test('Row 5: PreToolUse, non-Bash PostToolUseFailure, and relative cwd do not capture rows', () => {
  const ctx = newCaseWorkspace('no-capture-controls');

  const preRes = runHook(
    CANONICAL_ADAPTER,
    preToolPayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess',
      tool_input: { command: 'git commit -m "Bad Subject"' }
    }),
    ctx.env
  );
  assert.equal(preRes.status, 0);
  assert.ok(preRes.stdout.trim(), 'PreToolUse still delivers repo lesson');

  const nonBashFail = runHook(
    CANONICAL_ADAPTER,
    failurePayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess',
      tool_name: 'Write',
      tool_use_id: 'toolu_write_fail'
    }),
    ctx.env
  );
  assert.equal(nonBashFail.status, 0);
  assert.equal(nonBashFail.stdout, '');

  const relativeCwdFail = runHook(
    CANONICAL_ADAPTER,
    failurePayload('.', {
      session_id: 'ctrl-sess',
      tool_use_id: 'toolu_rel_cwd'
    }),
    ctx.env
  );
  assert.equal(relativeCwdFail.status, 0);
  assert.equal(relativeCwdFail.stdout, '');

  assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 0, 'none of the negative controls created an occurrence row');

  // Positive control in the same workspace confirms the oracle reaches the store.
  const posRes = runHook(
    CANONICAL_ADAPTER,
    failurePayload(ctx.workspaceRoot, {
      session_id: 'ctrl-sess',
      tool_use_id: 'toolu_pos_ctrl'
    }),
    ctx.env
  );
  assert.equal(posRes.status, 0);
  assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 1, 'positive control captures exactly one row');
});

test('Row 7: packaged copy passes End-to-end A and End-to-end B', () => {
  assert.ok(fs.existsSync(PACKAGED_ADAPTER), 'packaged ledger-lesson.js exists');
  runEndToEndA(PACKAGED_ADAPTER, 'packaged');
  runEndToEndB(PACKAGED_ADAPTER, 'packaged');
});
