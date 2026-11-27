#!/usr/bin/env node
'use strict';

// P5-553: retired W6 CLI (`inventory` / `seal`) must exit 2 with the §4 message,
// empty stdout, and unchanged session state before reading workspace/session,
// loading the E1 provider, or writing files.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { canonical } = require('../hooks/scripts/lib/workflow-isolation');

const ROOT = path.resolve(__dirname, '..');
const SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const EXPECTED_STDERR = '[W6 State Operation] E1 pilot retired. Finish on the previous release or start a new session.';
const APPROVED_INVENTORY = path.join(
  ROOT,
  'benchmarks/results/live-host/claude-341-outline-dispatch-2026-10-28/inventory/2741bd4514d2cd68f57d93a2b3ce94cbe597ca62d30e26f0ca58e882df5b03c6.md'
);

const TEMP = canonical(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-553-p5-w6-')));
const STATE_HOME = path.join(TEMP, 'state-home');
const LEGS = [
  { id: 'source', hooks: path.join(ROOT, 'hooks', 'scripts') },
  { id: 'packaged', hooks: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts') },
];

const ORIGINAL_ENV = {
  stateHome: process.env.HARNESS_STATE_HOME,
  workspaceRoot: process.env.HARNESS_WORKSPACE_ROOT,
  pilot: process.env[SWITCH],
};
process.env.HARNESS_STATE_HOME = STATE_HOME;

let failed = 0;
function check(condition, id, detail = '') {
  if (condition) console.log(`  PASS ${id}`);
  else {
    console.error(`  FAIL ${id}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function git(cwd, args) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'p5-553-fixture',
    GIT_AUTHOR_EMAIL: 'p5-553@invalid',
    GIT_COMMITTER_NAME: 'p5-553-fixture',
    GIT_COMMITTER_EMAIL: 'p5-553@invalid',
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') && !/^GIT_(AUTHOR|COMMITTER)_/.test(key)) delete env[key];
  }
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function snapshotTree(dir) {
  const entries = [];
  function walk(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, item.name);
      const rel = path.relative(dir, full).replace(/\\/g, '/');
      if (item.isDirectory()) {
        entries.push({ type: 'dir', rel });
        walk(full);
      } else if (item.isFile()) {
        entries.push({ type: 'file', rel, sha256: sha(fs.readFileSync(full)) });
      } else if (item.isSymbolicLink()) {
        entries.push({ type: 'symlink', rel, target: fs.readlinkSync(full) });
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return entries;
}

function buildEnv(workspace, flag) {
  const env = {
    ...process.env,
    HARNESS_STATE_HOME: STATE_HOME,
    HARNESS_WORKSPACE_ROOT: workspace,
  };
  if (flag === null) delete env[SWITCH];
  else env[SWITCH] = flag;
  return env;
}

function createSeededSession(leg, label, operation) {
  const workspace = path.join(TEMP, `ws-${leg.id}-${label}-${operation}`);
  fs.mkdirSync(path.join(workspace, '.agents/harness-everything'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'docs/adr'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.agents/harness-everything/project-docs.json'),
    JSON.stringify({ governed: [{ path: 'docs/adr/*.md', role: 'adr' }], domains: ['EVID'], derived: [] }, null, 2) + '\n',
    'utf8'
  );
  git(workspace, ['init', '-q']);
  git(workspace, ['add', '-A']);
  git(workspace, ['commit', '-q', '-m', 'baseline B']);
  const baselineCommit = git(workspace, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const baselineTree = git(workspace, ['rev-parse', '--verify', 'HEAD^{tree}']);

  const cliPath = path.join(leg.hooks, 'w6-state-operations.js');
  const sessionId = `p5-553-${leg.id}-${label}-${operation}`;
  const provider = require(path.join(leg.hooks, 'lib', 'doc-reconciliation-provider.js'));
  const state = require(path.join(leg.hooks, 'lib', 'harness-state.js'));
  const previousWs = process.env.HARNESS_WORKSPACE_ROOT;
  process.env.HARNESS_WORKSPACE_ROOT = workspace;
  const sessionDir = state.getSessionDir(workspace, sessionId);
  if (previousWs === undefined) delete process.env.HARNESS_WORKSPACE_ROOT;
  else process.env.HARNESS_WORKSPACE_ROOT = previousWs;

  const workflowId = `wf-${sessionId}`;
  const taskId = 'task-adr-evid+verify-row17';
  writeJson(path.join(sessionDir, 'workflow-run.json'), {
    schemaVersion: 2,
    workflowId,
    sessionId,
    revision: 1,
    state: 'running',
    strategy: 'iterative-single',
    tier: 'tier2',
    strategySelection: 'selected',
    lastMutationAt: 1000,
    docReconciliationBaseline: { root: workspace, commit: baselineCommit, tree: baselineTree },
    docReconciliationTask: {
      schema: 'harness.doc-reconciliation-task-pin.v1',
      taskId,
      requirementIds: ['adr-evid', 'verify-row17'],
      sessionId,
      workflowId,
      workspaceId: 'ws-p5-553',
      configDigest: sha(Buffer.from('cfg')),
      baselineRoot: workspace,
      baselineCommit,
    },
  });

  const handoffBefore = { lastEditAt: 1000 };
  writeJson(path.join(sessionDir, 'handoff-state.json'), handoffBefore);

  const captures = [
    {
      ref: 'cap-pre-1',
      event: 'PreToolUse',
      tool_name: 'Bash',
      session_id: sessionId,
      tool_use_id: `tu-${operation}-1`,
      cwd: workspace,
      command: `node "${cliPath}" ${operation} --session-id "${sessionId}"`,
    },
  ];

  if (operation === 'seal') {
    const target = 'docs/adr/EVID-001.md';
    const outlineText = '---\nid: EVID-001\nstatus: proposed\n---\n\nInventory row: 17\nTarget: docs/adr/EVID-001.md\nDomain: EVID\n\n## Outline\n- Context: TBD\n- Decision: TBD\n';
    fs.writeFileSync(path.join(workspace, target), outlineText, 'utf8');
    git(workspace, ['add', '--', target]);
    git(workspace, ['commit', '-q', '-m', 'O outline']);
    const head = git(workspace, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const tree = git(workspace, ['rev-parse', '--verify', 'HEAD^{tree}']);

    const expectedPin = provider._internals.OUTLINE_INVENTORY_PIN;
    const invBytes = fs.readFileSync(APPROVED_INVENTORY);
    const invDir = path.join(sessionDir, 'doc-reconciliation/outline-confirmation/inventory');
    fs.mkdirSync(invDir, { recursive: true });
    fs.writeFileSync(path.join(invDir, path.posix.basename(expectedPin.retainedArtifactPath)), invBytes);
    fs.writeFileSync(path.join(invDir, 'inventory-pin.json'), JSON.stringify(expectedPin, null, 2) + '\n', 'utf8');

    const invRel = `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(expectedPin.retainedArtifactPath)}`;
    const reviewSummary = `Approved inventory row 17 for ${target} in domain EVID`;
    captures.push(
      {
        ref: 'cap-start-1',
        event: 'SubagentStart',
        session_id: sessionId,
        agent_id: 'reviewer-1',
        agent_type: 'reviewer',
        outlineIdentity: { state: 'accepted', identity: { outlineCommit: head, outlineTree: tree } },
      },
      {
        ref: 'cap-launch-1',
        event: 'PostToolUse',
        session_id: sessionId,
        tool_name: 'Task',
        tool_use_id: 'tu-review-1',
        agent_id: 'reviewer-1',
        agent_type: 'reviewer',
      },
      {
        ref: 'cap-review-1',
        event: 'SubagentStop',
        session_id: sessionId,
        agent_id: 'reviewer-1',
        agent_type: 'reviewer',
        reviewVerdict: 'approve',
        reviewSummary,
        reviewDigest: sha(Buffer.from(reviewSummary)),
        reviewedArtifactDigests: {
          [invRel]: sha(invBytes),
          [target]: sha(Buffer.from(outlineText)),
        },
      }
    );
  }

  writeJson(path.join(sessionDir, 'doc-reconciliation-capture.json'), { version: 1, records: captures });
  return { workspace, sessionId, sessionDir, cliPath, handoffBefore };
}

function createSentinelPreload(leg, cliPath, workspace, sessionDir, sentinelFile) {
  const preload = path.join(TEMP, `sentinel-${leg.id}-${crypto.randomBytes(4).toString('hex')}.js`);
  const source = [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const Module = require('module');",
    "const cp = require('child_process');",
    `const targetCli = fs.realpathSync.native(${JSON.stringify(cliPath)});`,
    `const wsRoot = ${JSON.stringify(workspace)};`,
    `const stateHome = ${JSON.stringify(STATE_HOME)};`,
    `const sessDir = ${JSON.stringify(sessionDir)};`,
    `const outPath = ${JSON.stringify(sentinelFile)};`,
    'const log = { enteredCli: false, loads: [], fsTouches: [], spawns: [] };',
    'const flush = () => fs.writeFileSync(outPath, JSON.stringify(log, null, 2));',
    "process.on('exit', flush);",
    'const origLoad = Module._load;',
    'Module._load = function (request, parent, isMain) {',
    '  const parentPath = parent?.filename ? fs.realpathSync.native(parent.filename) : null;',
    '  if (isMain) {',
    '    try {',
    '      if (fs.realpathSync.native(request) === targetCli) log.enteredCli = true;',
    '    } catch {}',
    '  }',
    '  if (parentPath === targetCli) {',
    '    log.loads.push(String(request));',
    '  }',
    '  return Reflect.apply(origLoad, this, [request, parent, isMain]);',
    '};',
    'function recordIfTarget(op, targetPath) {',
    '  if (!log.enteredCli || typeof targetPath !== "string") return;',
    '  const resolved = path.resolve(targetPath);',
    '  if (resolved.startsWith(wsRoot) || resolved.startsWith(stateHome) || resolved.startsWith(sessDir)) {',
    '    log.fsTouches.push({ op, path: resolved });',
    '  }',
    '}',
    'for (const fn of ["readFileSync", "writeFileSync", "mkdirSync", "readdirSync", "lstatSync", "existsSync"]) {',
    '  const orig = fs[fn];',
    '  fs[fn] = function (p) {',
    '    recordIfTarget(fn, p);',
    '    return Reflect.apply(orig, this, arguments);',
    '  };',
    '}',
    'const origExecFileSync = cp.execFileSync;',
    'cp.execFileSync = function (file) {',
    '  if (log.enteredCli) log.spawns.push(String(file));',
    '  return Reflect.apply(origExecFileSync, this, arguments);',
    '};',
  ].join('\n') + '\n';
  fs.writeFileSync(preload, source, 'utf8');
  return preload;
}

function runW6Direct(leg, operation, flag) {
  const { workspace, sessionId, sessionDir, cliPath, handoffBefore } = createSeededSession(leg, flag === null ? 'unset' : flag, operation);
  const beforeTree = snapshotTree(sessionDir);
  const result = spawnSync(process.execPath, [cliPath, operation, '--session-id', sessionId], {
    cwd: workspace,
    encoding: 'utf8',
    env: buildEnv(workspace, flag),
    timeout: 10000,
  });
  const afterTree = snapshotTree(sessionDir);
  const handoffAfter = readJson(path.join(sessionDir, 'handoff-state.json'));
  const stderrLines = String(result.stderr || '').split(/\r?\n/).filter(Boolean);
  const flagName = flag === null ? 'unset' : flag;
  const prefix = `w6.${leg.id}.${operation}.${flagName}`;

  check(result.status === 2, `${prefix}.exit-2`, `got exit ${result.status}; stderr=${JSON.stringify(result.stderr)}`);
  check(
    stderrLines.length === 1 && stderrLines[0] === EXPECTED_STDERR,
    `${prefix}.exact-stderr`,
    `got ${JSON.stringify(result.stderr)}`
  );
  check(result.stdout === '', `${prefix}.empty-stdout`, `got ${JSON.stringify(result.stdout)}`);
  check(
    JSON.stringify(afterTree) === JSON.stringify(beforeTree),
    `${prefix}.session-dir-unchanged`,
    `before=${beforeTree.length} entries, after=${afterTree.length} entries`
  );
  check(
    JSON.stringify(handoffAfter) === JSON.stringify(handoffBefore)
      && handoffAfter.lastVerifyAt === undefined
      && handoffAfter.lastDocVerifyAt === undefined
      && handoffAfter.lastDocVerifyExitCode === undefined,
    `${prefix}.no-verify-time-or-handoff`,
    JSON.stringify(handoffAfter)
  );
  const attemptDir = path.join(sessionDir, 'doc-reconciliation/outline-confirmation/task-adr-evid+verify-row17/attempts');
  check(!fs.existsSync(attemptDir), `${prefix}.no-attempt-handoff-dir`, attemptDir);
}

function runW6Sentinel(leg, operation) {
  const { workspace, sessionId, sessionDir, cliPath } = createSeededSession(leg, 'sentinel', operation);
  const sentinelFile = path.join(TEMP, `sentinel-out-${leg.id}-${operation}.json`);
  const preload = createSentinelPreload(leg, cliPath, workspace, sessionDir, sentinelFile);
  const result = spawnSync(process.execPath, ['--require', preload, cliPath, operation, '--session-id', sessionId], {
    cwd: workspace,
    encoding: 'utf8',
    env: buildEnv(workspace, '1'),
    timeout: 10000,
  });
  const sentinel = fs.existsSync(sentinelFile) ? readJson(sentinelFile) : null;
  const prefix = `sentinel.${leg.id}.${operation}`;
  console.log(`  SENTINEL ${leg.id}/${operation}: ${JSON.stringify(sentinel)}`);
  check(sentinel && sentinel.enteredCli === true, `${prefix}.reached-cli`, JSON.stringify(sentinel));
  check(result.status === 2 && result.stdout === '', `${prefix}.exit2-empty-stdout`, `status=${result.status}`);
  const forbiddenLoad = (sentinel?.loads || []).filter(req =>
    /(?:harness-state|workflow-isolation|doc-reconciliation-provider|doc-reconciliation-pilot|workspace|child_process)/.test(req)
  );
  check(forbiddenLoad.length === 0, `${prefix}.no-provider-or-state-load`, JSON.stringify(sentinel?.loads));
  check((sentinel?.fsTouches || []).length === 0, `${prefix}.no-workspace-or-session-io`, JSON.stringify(sentinel?.fsTouches));
  check((sentinel?.spawns || []).length === 0, `${prefix}.no-git-or-child-spawn`, JSON.stringify(sentinel?.spawns));
}

console.log('=== P5-553 W6 CLI retirement ===');
try {
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.hooks, 'w6-state-operations.js'))) {
      check(false, `layout.${leg.id}.present`, 'w6-state-operations.js is missing');
      continue;
    }
    for (const operation of ['inventory', 'seal']) {
      for (const flag of [null, '0', '1']) {
        runW6Direct(leg, operation, flag);
      }
      runW6Sentinel(leg, operation);
    }
  }
} catch (error) {
  console.error(`INFRA ${error.stack || error}`);
  failed++;
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
  if (ORIGINAL_ENV.stateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = ORIGINAL_ENV.stateHome;
  if (ORIGINAL_ENV.workspaceRoot === undefined) delete process.env.HARNESS_WORKSPACE_ROOT;
  else process.env.HARNESS_WORKSPACE_ROOT = ORIGINAL_ENV.workspaceRoot;
  if (ORIGINAL_ENV.pilot === undefined) delete process.env[SWITCH];
  else process.env[SWITCH] = ORIGINAL_ENV.pilot;
}

if (failed) {
  console.error(`FAIL P5-553 W6 CLI retirement: ${failed} assertions`);
  process.exitCode = 1;
} else {
  console.log('PASS P5-553 W6 CLI retirement');
}
