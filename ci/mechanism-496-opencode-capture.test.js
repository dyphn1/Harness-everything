#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createV2Driver } = require('./lib/opencode-v2-driver');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const ERRORS_SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const ERRORS_LOCAL = path.join(ROOT, 'scripts', 'errors-local.js');
const LEDGER = path.join(ROOT, '.agents', 'harness-everything', 'errors');
const E3_FILE = fs.readdirSync(LEDGER).find(file => /^E-0003-[a-z0-9-]+\.md$/.test(file));
const COMMITLINT_OUTPUT = fs.readFileSync(
  path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'),
  'utf8'
);

const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR',
  'HARNESS_OBSERVATIONS', 'HARNESS_TELEMETRY', 'HARNESS_SYSTEM_ONE_MODE',
  'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR', 'HARNESS_WORKSPACE_ROOT', 'FABLE_WORKSPACE_ROOT',
];
const OLD_ENV = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

// E-0011: canonicalize temp root with realpathSync.native to expand Windows 8.3 short paths.
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), '496-opencode-capture-')));
let serial = 0;

function isOutside(root, target) {
  const rel = path.relative(root, target);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

test.after(() => {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

function newCaseWorkspace(name, { withLedger = true } = {}) {
  const caseDir = path.join(TMP, `${name}-${++serial}`);
  const workspaceRoot = path.join(caseDir, 'workspace');
  const homeDir = path.join(caseDir, 'home');
  const stateHome = path.join(caseDir, 'state-home');
  const obsDir = path.join(caseDir, 'observations');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });
  if (withLedger) {
    const ledgerDir = path.join(workspaceRoot, '.agents', 'harness-everything', 'errors');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.copyFileSync(path.join(LEDGER, E3_FILE), path.join(ledgerDir, E3_FILE));
    const synced = spawnSync(process.execPath, [ERRORS_SYNC, '--root', workspaceRoot], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(synced.status, 0, synced.stderr || 'errors-sync should succeed');
  }
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    HARNESS_STATE_HOME: stateHome,
    HARNESS_OBSERVATIONS_DIR: obsDir,
    HARNESS_OBSERVATIONS: 'off',
    HARNESS_TELEMETRY: 'off',
  };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CODEX_PROJECT_DIR;
  delete env.HARNESS_WORKSPACE_ROOT;
  delete env.FABLE_WORKSPACE_ROOT;
  return { caseDir, workspaceRoot, homeDir, stateHome, obsDir, env };
}

function applyCaseEnv(ctx) {
  process.env.HOME = ctx.homeDir;
  process.env.USERPROFILE = ctx.homeDir;
  process.env.HARNESS_STATE_HOME = ctx.stateHome;
  process.env.HARNESS_OBSERVATIONS_DIR = ctx.obsDir;
  process.env.HARNESS_OBSERVATIONS = 'off';
  process.env.HARNESS_TELEMETRY = 'off';
  delete process.env.HARNESS_SYSTEM_ONE_MODE;
  delete process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CODEX_PROJECT_DIR;
  delete process.env.HARNESS_WORKSPACE_ROOT;
  delete process.env.FABLE_WORKSPACE_ROOT;
}

function runCli(args, cwd, env) {
  return spawnSync(process.execPath, [ERRORS_LOCAL, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

function listRecords(workspaceRoot, env, extraArgs = []) {
  const res = runCli(['list', '--json', ...extraArgs], workspaceRoot, env);
  assert.equal(res.status, 0, res.stderr || 'errors-local list should exit 0');
  return JSON.parse(res.stdout);
}

function packagePlugin(name, { includeLocalErrors = true } = {}) {
  const installed = path.join(TMP, `packaged-${name}-${++serial}`);
  const pluginDir = path.join(installed, 'plugins');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(PLUGIN, path.join(pluginDir, 'harness-enforcement.mjs'));
  const files = [
    'harness-everything/scripts/kernel-router.js',
    'hooks/scripts/lib/observations.js',
    'hooks/scripts/lib/ledger-match.js',
    'hooks/scripts/lib/harness-state.js',
    'scripts/lib/workspace.js',
    ...(includeLocalErrors
      ? [
          'hooks/scripts/lib/local-errors.js',
          'hooks/scripts/lib/local-error-source.js',
        ]
      : []),
  ];
  for (const rel of files) {
    const destination = path.join(installed, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), destination);
  }
  fs.cpSync(
    path.join(ROOT, 'hooks/scripts/lib/platforms'),
    path.join(installed, 'hooks/scripts/lib/platforms'),
    { recursive: true }
  );
  return path.join(pluginDir, 'harness-enforcement.mjs');
}

async function readContext(driver, sessionID, base = 'base system') {
  const event = { sessionID, kind: 'primary', system: [{ type: 'text', text: base }] };
  await driver.sessionHook('context')(event);
  return event.system.map(part => part.text || '').join('\n');
}

async function runWithDriver(ctx, fn, { plugin } = {}) {
  const driver = await createV2Driver({
    workspace: ctx.workspaceRoot,
    ...(plugin ? { plugin } : {}),
  });
  applyCaseEnv(ctx);
  try {
    return await fn(driver);
  } finally {
    await driver.teardown();
  }
}

test('Row 1: confirmed failure captures one redacted occurrence with matchedLedgerIds (error status and nonzero metadata.exit)', async () => {
  assert.ok(isOutside(ROOT, TMP), 'fixture state must stay outside the repository');

  // Case 1a: status === 'error' on bash tool
  const ctxA = newCaseWorkspace('confirmed-error');
  const secretPath = path.join(ctxA.homeDir, 'private-project', 'secret.txt');
  const errorWithHome = `${COMMITLINT_OUTPUT}\nsee ${secretPath}\n`;
  await runWithDriver(ctxA, async driver => {
    const after = {
      tool: 'bash',
      sessionID: 'sess-e2e-a',
      agent: 'build',
      messageID: 'msg-a',
      id: 'call-e2e-a',
      input: { command: 'git commit -m "Bad Subject"' },
      status: 'error',
      error: { name: 'ToolError', message: errorWithHome },
    };
    const snapshot = structuredClone(after);
    assert.equal(await driver.toolHook('execute.after')(after), undefined);
    assert.deepEqual(after, snapshot, 'execute.after must not mutate the host tool event');

    const delivered = await readContext(driver, 'sess-e2e-a');
    assert.match(delivered, /Check the subject line against both rules/);
  });

  const recordsA = listRecords(ctxA.workspaceRoot, ctxA.env);
  assert.equal(recordsA.length, 1, 'exactly one occurrence row captured');
  const rowA = recordsA[0];
  assert.equal(rowA.kind, 'occurrence');
  assert.equal(rowA.host, 'opencode');
  assert.equal(rowA.destination, 'unknown');
  assert.equal(rowA.commandClass, 'git');
  assert.equal(rowA.exitCode, null);
  assert.ok(rowA.sessionKey && !rowA.sessionKey.includes('sess-e2e-a'), 'sessionKey is opaque');
  assert.ok(rowA.toolUseId && !rowA.toolUseId.includes('call-e2e-a'), 'toolUseId is opaque');
  assert.ok(rowA.outputExcerpt.includes('<home>'), 'home path is redacted in outputExcerpt');
  assert.ok(!rowA.outputExcerpt.includes(ctxA.homeDir), 'raw home path is not stored in outputExcerpt');
  assert.ok(rowA.matchedLedgerIds.includes('E-0003'), `matchedLedgerIds should include E-0003, got ${JSON.stringify(rowA.matchedLedgerIds)}`);

  // Case 1b: live OpenCode 2.1.4 shell shape (status === 'completed', finite nonzero metadata.exit)
  const ctxB = newCaseWorkspace('confirmed-nonzero-exit');
  const secretPathB = path.join(ctxB.homeDir, 'private-project', 'secret.txt');
  const outputWithHome = `${COMMITLINT_OUTPUT}\nsee ${secretPathB}\n`;
  await runWithDriver(ctxB, async driver => {
    const after = {
      tool: 'shell',
      sessionID: 'sess-e2e-b',
      agent: 'build',
      messageID: 'msg-b',
      id: 'call-e2e-b',
      input: { command: 'git -C x commit -m "docs(errors): Bad Case"', workdir: ctxB.workspaceRoot },
      status: 'completed',
      result: {
        output: { exit: 1, truncated: false, output: outputWithHome, status: 'completed' },
        content: [{ type: 'text', text: outputWithHome }],
        metadata: { status: 'completed', truncated: false, exit: 1 },
      },
    };
    const snapshot = structuredClone(after);
    assert.equal(await driver.toolHook('execute.after')(after), undefined);
    assert.deepEqual(after, snapshot, 'execute.after must not mutate live shell tool result');
  });

  const recordsB = listRecords(ctxB.workspaceRoot, ctxB.env);
  assert.equal(recordsB.length, 1, 'nonzero metadata.exit captures one occurrence row');
  assert.equal(recordsB[0].host, 'opencode');
  assert.equal(recordsB[0].exitCode, 1);
  assert.equal(recordsB[0].commandClass, 'git');
  assert.ok(recordsB[0].outputExcerpt.includes('<home>'));
  assert.ok(!recordsB[0].outputExcerpt.includes(ctxB.homeDir));
  assert.ok(recordsB[0].matchedLedgerIds.includes('E-0003'));
});

test('Row 2: CLI-added provisional lesson is injected on next action event (labelled provisional, no counts)', async () => {
  const ctx = newCaseWorkspace('provisional-action', { withLedger: false });
  const lessonText = 'Run npm run build before npm test in this project';

  const addRes = runCli(
    [
      'add',
      '--executable', 'npm',
      '--subcommand', 'test',
      '--lesson', lessonText,
      '--destination', 'project',
    ],
    ctx.workspaceRoot,
    ctx.env
  );
  assert.equal(addRes.status, 0, addRes.stderr || 'errors-local add exits 0');

  await runWithDriver(ctx, async driver => {
    const before = {
      tool: 'bash',
      sessionID: 'sess-prov',
      agent: 'build',
      messageID: 'msg-prov',
      id: 'call-prov',
      input: { command: 'npm test' },
    };
    const snapshot = structuredClone(before);
    assert.equal(await driver.toolHook('execute.before')(before), undefined);
    assert.deepEqual(before, snapshot, 'execute.before must not mutate the tool request');

    const delivered = await readContext(driver, 'sess-prov');
    assert.ok(delivered.includes(lessonText), 'injected context contains provisional lesson text');
    assert.match(delivered, /provisional/i, 'injected context labels lesson as provisional');
    assert.doesNotMatch(delivered, /\b\d+\s*(?:times?|occurrences?|count|failures?)\b/i, 'no counts injected in lesson text');
  });

  // Action event must not capture an occurrence row.
  assert.equal(listRecords(ctx.workspaceRoot, ctx.env, ['--kind', 'occurrence']).length, 0);
});

test('Row 3: unknown/zero outcomes and masked-failure exception do not capture; confirmed failure with no output still captures', async () => {
  const ctx = newCaseWorkspace('outcomes');

  await runWithDriver(ctx, async driver => {
    // Action event -> no row
    await driver.toolHook('execute.before')({
      tool: 'bash',
      sessionID: 'sess-outcomes',
      agent: 'build',
      messageID: 'msg-1',
      id: 'call-before',
      input: { command: 'git commit -m "Bad Subject"' },
    });

    // Zero exit -> no row
    await driver.toolHook('execute.after')({
      tool: 'bash',
      sessionID: 'sess-outcomes',
      agent: 'build',
      messageID: 'msg-2',
      id: 'call-zero',
      input: { command: 'git commit -m "Bad Subject"' },
      status: 'completed',
      result: { output: COMMITLINT_OUTPUT, metadata: { exit: 0 } },
    });

    // Masked-failure compound command with exit 0 -> reminder still fires, but NO capture row
    await driver.toolHook('execute.after')({
      tool: 'bash',
      sessionID: 'sess-masked',
      agent: 'build',
      messageID: 'msg-3',
      id: 'call-masked',
      input: { command: 'git commit -m "Bad Subject"; echo "$?"' },
      status: 'completed',
      result: { output: COMMITLINT_OUTPUT, metadata: { exit: 0 } },
    });
    const maskedContext = await readContext(driver, 'sess-masked');
    assert.match(maskedContext, /subject-case/, 'masked-failure reminder behavior stays intact');

    // Unknown exit (metadata.exit absent) -> no row
    await driver.toolHook('execute.after')({
      tool: 'bash',
      sessionID: 'sess-outcomes',
      agent: 'build',
      messageID: 'msg-4',
      id: 'call-unknown',
      input: { command: 'git commit -m "Bad Subject"' },
      status: 'completed',
      result: { output: COMMITLINT_OUTPUT, metadata: {} },
    });

    // Non-shell tool error -> no row
    await driver.toolHook('execute.after')({
      tool: 'write',
      sessionID: 'sess-outcomes',
      agent: 'build',
      messageID: 'msg-5',
      id: 'call-write-err',
      input: { command: 'git commit -m "Bad Subject"' },
      status: 'error',
      error: { name: 'ToolError', message: 'disk full' },
    });

    assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 0,
      'none of the negative controls created an occurrence row');

    // Positive control 1: status === 'error' with no output at all -> 1 row
    await driver.toolHook('execute.after')({
      tool: 'bash',
      sessionID: 'sess-outcomes',
      agent: 'build',
      messageID: 'msg-6',
      id: 'call-err-no-output',
      input: { command: 'npm test' },
      status: 'error',
    });
    const afterErrNoOut = listRecords(ctx.workspaceRoot, ctx.env);
    assert.equal(afterErrNoOut.length, 1, 'status=error with no output captures 1 row');
    assert.equal(afterErrNoOut[0].exitCode, null);
    assert.equal(afterErrNoOut[0].outputExcerpt, '');
    assert.equal(afterErrNoOut[0].commandClass, 'test');

    // Positive control 2: status === 'completed' with finite nonzero metadata.exit and no output -> 2nd row
    await driver.toolHook('execute.after')({
      tool: 'shell',
      sessionID: 'sess-outcomes',
      agent: 'build',
      messageID: 'msg-7',
      id: 'call-exit-no-output',
      input: { command: 'npm run build' },
      status: 'completed',
      result: { metadata: { exit: 2 } },
    });
    const afterExitNoOut = listRecords(ctx.workspaceRoot, ctx.env);
    assert.equal(afterExitNoOut.length, 2, 'nonzero metadata.exit with no output captures 2nd row');
    assert.equal(afterExitNoOut[1].exitCode, 2);
    assert.equal(afterExitNoOut[1].outputExcerpt, '');
    assert.equal(afterExitNoOut[1].commandClass, 'build');
  });
});

test('Row 4: unwritable store or missing modules leave injected context identical and do not throw', async () => {
  const normalCtx = newCaseWorkspace('failopen-normal');
  const blockedCtx = newCaseWorkspace('failopen-unwritable');
  // Regular file at HARNESS_OBSERVATIONS_DIR causes store writes to fail on POSIX and Windows.
  fs.writeFileSync(blockedCtx.obsDir, 'not-a-directory', 'utf8');

  const eventFor = () => ({
    tool: 'bash',
    sessionID: 'sess-failopen',
    agent: 'build',
    messageID: 'msg-failopen',
    id: 'call-failopen',
    input: { command: 'git commit -m "Bad Subject"' },
    status: 'error',
    error: { name: 'ToolError', message: COMMITLINT_OUTPUT },
  });

  const normalContext = await runWithDriver(normalCtx, async driver => {
    await driver.toolHook('execute.after')(eventFor());
    return readContext(driver, 'sess-failopen');
  });
  const blockedContext = await runWithDriver(blockedCtx, async driver => {
    await driver.toolHook('execute.after')(eventFor());
    return readContext(driver, 'sess-failopen');
  });

  assert.match(normalContext, /Check the subject line against both rules/);
  assert.equal(blockedContext, normalContext, 'unwritable store leaves injected context identical');
  assert.equal(listRecords(normalCtx.workspaceRoot, normalCtx.env).length, 1, 'positive control captured 1 row');
  assert.equal(listRecords(blockedCtx.workspaceRoot, blockedCtx.env).length, 0, 'blocked store captured 0 rows');

  // Missing local-errors.js / local-error-source.js in a packaged plugin -> identical context, no throw.
  const missingCtx = newCaseWorkspace('failopen-missing-mod');
  const missingPlugin = packagePlugin('missing-local-errors', { includeLocalErrors: false });
  const missingContext = await runWithDriver(missingCtx, async driver => {
    await driver.toolHook('execute.after')(eventFor());
    return readContext(driver, 'sess-failopen');
  }, { plugin: missingPlugin });

  assert.equal(missingContext, normalContext, 'missing local-error modules leave injected context identical');
  assert.equal(listRecords(missingCtx.workspaceRoot, missingCtx.env).length, 0);

  // Packaged plugin WITH local-errors.js / local-error-source.js -> captures AND delivers provisional lesson.
  const packagedCtx = newCaseWorkspace('packaged-full');
  const fullPlugin = packagePlugin('full-local-errors', { includeLocalErrors: true });
  const addRes = runCli(
    ['add', '--executable', 'npm', '--subcommand', 'test', '--lesson', 'Packaged provisional lesson', '--destination', 'project'],
    packagedCtx.workspaceRoot,
    packagedCtx.env
  );
  assert.equal(addRes.status, 0, addRes.stderr);

  await runWithDriver(packagedCtx, async driver => {
    await driver.toolHook('execute.before')({
      tool: 'bash',
      sessionID: 'sess-pkg',
      agent: 'build',
      messageID: 'msg-pkg-1',
      id: 'call-pkg-1',
      input: { command: 'npm test' },
    });
    const pkgActionCtx = await readContext(driver, 'sess-pkg');
    assert.match(pkgActionCtx, /Packaged provisional lesson/);
    assert.match(pkgActionCtx, /provisional/i);

    await driver.toolHook('execute.after')(eventFor());
  }, { plugin: fullPlugin });

  const pkgOccurrences = listRecords(packagedCtx.workspaceRoot, packagedCtx.env, ['--kind', 'occurrence']);
  assert.equal(pkgOccurrences.length, 1, 'packaged plugin captures occurrence');
  assert.ok(pkgOccurrences[0].matchedLedgerIds.includes('E-0003'));
});

test('Row 5: same call id is idempotent; distinct call ids create two rows both with matchedLedgerIds', async () => {
  const ctx = newCaseWorkspace('idempotency');

  await runWithDriver(ctx, async driver => {
    const baseEvent = {
      tool: 'bash',
      sessionID: 'sess-idem',
      agent: 'build',
      messageID: 'msg-idem',
      input: { command: 'git commit -m "Bad Subject"' },
      status: 'error',
      error: { name: 'ToolError', message: COMMITLINT_OUTPUT },
    };

    // First failure: delivers lesson and captures 1 row.
    await driver.toolHook('execute.after')({ ...baseEvent, id: 'call-same' });
    const firstCtx = await readContext(driver, 'sess-idem');
    assert.match(firstCtx, /Check the subject line against both rules/);

    // Duplicate call id: delivery silent, still 1 row.
    await driver.toolHook('execute.after')({ ...baseEvent, id: 'call-same' });
    assert.equal(await readContext(driver, 'sess-idem'), 'base system', 'duplicate failure delivery is silent');
    assert.equal(listRecords(ctx.workspaceRoot, ctx.env).length, 1, 'same call id is idempotent (1 row)');

    // Distinct call id: delivery still silent (session already claimed), but 2nd row captured with matchedLedgerIds.
    await driver.toolHook('execute.after')({ ...baseEvent, id: 'call-distinct' });
    assert.equal(await readContext(driver, 'sess-idem'), 'base system', 'second distinct failure delivery is silent');

    const records = listRecords(ctx.workspaceRoot, ctx.env);
    assert.equal(records.length, 2, 'distinct call id creates a second row');
    assert.ok(records[0].matchedLedgerIds.includes('E-0003'));
    assert.ok(records[1].matchedLedgerIds.includes('E-0003'), 'second silent failure still records matchedLedgerIds');
  });
});
