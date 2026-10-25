'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const STOP_GATE = path.join(ROOT, 'hooks/scripts/workflow-stop-gate.js');
const PILOT = path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-pilot.js');
const savedEnv = Object.fromEntries(['HOME', 'HARNESS_STATE_HOME', 'HARNESS_WORKSPACE_ROOT', 'HARNESS_DOC_RECONCILIATION_PILOT'].map(key => [key, process.env[key]]));

function git(cwd, args) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Harness test', GIT_AUTHOR_EMAIL: 'harness@example.invalid', GIT_COMMITTER_NAME: 'Harness test', GIT_COMMITTER_EMAIL: 'harness@example.invalid' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].includes(key)) delete env[key];
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env });
}

function runJson(script, cwd, input, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
  });
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-opencode-workspace-'));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-opencode-state-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-opencode-home-'));
  fs.mkdirSync(path.join(root, '.agents/harness-everything'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/adr'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/harness-everything/project-docs.json'), JSON.stringify({ governed: [{ path: 'docs/adr/**', role: 'adr' }], domains: ['GRPH'] }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'docs/adr/GRPH-001.md'), '# GRPH-001 Retry\n\nCheckout MUST retry once.\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  const init = git(root, ['init', '-q']);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(git(root, ['add', '-A']).status, 0);
  assert.equal(git(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'baseline']).status, 0);
  fs.writeFileSync(path.join(root, 'docs/adr/GRPH-001.md'), '# GRPH-001 Retry\n\nCheckout MUST retry twice.\n');
  process.env.HOME = home;
  process.env.HARNESS_STATE_HOME = stateHome;
  process.env.HARNESS_WORKSPACE_ROOT = root;
  process.env.HARNESS_DOC_RECONCILIATION_PILOT = '1';
  return {
    root, stateHome, home,
    cleanup: () => {
      for (const directory of [root, stateHome, home]) fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function seedWorkflow(fixture, sessionId) {
  const payload = { session_id: sessionId, cwd: fixture.root, host_id: 'opencode' };
  const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
  const sessionDir = getSessionDir(fixture.root, sessionId, payload);
  const plan = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
  const context = {
    root: fixture.root,
    sessionId,
    sessionDir,
    file: path.join(sessionDir, 'workflow-run.json'),
    workflow: {
      schemaVersion: 1,
      workflowId: `wf-${sessionId}`,
      revision: 1,
      sessionId,
      tier: 'tier2',
      strategy: 'iterative-single',
      state: 'running',
      workflowPlan: plan,
    },
  };
  const obligations = require(path.join(ROOT, 'hooks/scripts/lib/workflow-obligations.js'));
  obligations.initializePlanningContract(context, plan);
  obligations.recordPlanning(context, JSON.stringify([
    { id: 'edit-doc', stepType: 'behavior-change', summary: 'Revise the governed retry requirement', acceptance: 'the normative requirement is updated' },
    { id: 'verify-doc', stepType: 'verification', summary: 'Verify the governed retry change', acceptance: 'the objective checks are recorded' },
  ]), plan, plan.strategy, 'fixture workflow for the OpenCode reconciliation path');
  obligations.materializeExecutionObligations(context, plan);
  require(PILOT).captureBaseline(context);
  require(path.join(ROOT, 'hooks/scripts/lib/workflow-runtime.js')).saveWorkflow(context);
  return { sessionDir, payload };
}

function writeEditState(sessionDir, values) {
  fs.writeFileSync(path.join(sessionDir, 'edit-state.json'), JSON.stringify({
    lastEditTime: null,
    verificationPending: false,
    editsSinceVerification: 0,
    followUpPending: false,
    followUpDeliveryPending: false,
    followUpMessage: null,
    lastFollowUpError: null,
    sessionStart: Date.now(),
    ...values,
  }));
}

function createEventStream() {
  const queued = [];
  const waiters = [];
  let last = null;
  let closed = false;
  return {
    subscribe(signal) {
      const iterator = {
        next() {
          if (last) { last.resolve(); last = null; }
          if (queued.length) {
            last = queued.shift();
            return Promise.resolve({ value: last.value, done: false });
          }
          if (closed) return Promise.resolve({ done: true });
          return new Promise(resolve => waiters.push(resolve));
        },
        return() { closed = true; return Promise.resolve({ done: true }); },
      };
      signal.addEventListener('abort', () => {
        closed = true;
        while (waiters.length) waiters.shift()({ done: true });
      }, { once: true });
      return { [Symbol.asyncIterator]: () => iterator };
    },
    async dispatch(value) {
      await new Promise(resolve => {
        const item = { value, resolve };
        if (waiters.length) {
          if (last) { last.resolve(); last = null; }
          last = item;
          waiters.shift()({ value, done: false });
        } else queued.push(item);
      });
    },
  };
}

async function startPlugin(workspace) {
  const plugin = await import(pathToFileURL(path.join(ROOT, 'opencode-plugin/index.mjs')).href);
  const registered = new Map();
  const stream = createEventStream();
  const dispose = await plugin.default.setup({
    location: { directory: workspace },
    tool: { hook: async (name, callback) => registered.set(name, callback) },
    session: { prompt: async () => ({}) },
    event: { subscribe: ({ signal }) => stream.subscribe(signal) },
  });
  return { registered, stream, dispose };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('existing Stop consumer writes a refused report without qualification', () => {
  const fixture = makeFixture();
  try {
    const control = seedWorkflow(fixture, 'stop-positive-control');
    const result = runJson(STOP_GATE, fixture.root, control.payload);
    const reportPath = path.join(control.sessionDir, 'doc-reconciliation-pilot.json');
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report?.pilotStatus, 'unresolved');
    assert.equal(report?.pilotCredit, false);
    assert.ok(report?.diagnostics?.length, 'existing consumer must retain a refusal diagnostic');
  } finally {
    fixture.cleanup();
    restoreEnv();
  }
});

test('OpenCode capture → idle Stop whole path is refused without live qualification', async () => {
  const fixture = makeFixture();
  const findings = [];
  let dispose;
  let originalAssess;
  try {
    const sessionId = 'native-v2-whole-path';
    const { sessionDir } = seedWorkflow(fixture, sessionId);
    const pilot = require(PILOT);
    originalAssess = pilot.assess;
    const assessmentSessions = [];
    pilot.assess = function (context, ...args) {
      assessmentSessions.push(context?.sessionId);
      return originalAssess.call(this, context, ...args);
    };

    const plugin = await startPlugin(fixture.root);
    dispose = plugin.dispose;
    const nativeResult = { output: 'private-result-body', metadata: { exit: 0 } };
    await plugin.registered.get('execute.after')({
      tool: 'edit', sessionID: sessionId, id: 'call-1', messageID: 'message-1',
      status: 'completed', result: nativeResult,
      input: { filePath: path.join(fixture.root, 'docs/adr/GRPH-001.md') },
    });
    await plugin.registered.get('execute.after')({
      tool: 'bash', sessionID: sessionId, id: 'call-2', messageID: 'message-2',
      status: 'completed', error: { name: 'NativeError', message: 'native command error', code: 'NATIVE_FAILURE' },
      input: { command: 'doc-check' },
    });

    const journal = path.join(sessionDir, 'opencode-captures.jsonl');
    let records = [];
    if (fs.existsSync(journal)) {
      const lines = fs.readFileSync(journal, 'utf8').trim().split(/\r?\n/);
      records = lines.map(line => JSON.parse(line));
    }
    const canonical = JSON.stringify(canonicalJson(nativeResult));
    const record = records[0];
    const errorRecord = records[1];
    if (records.length !== 2 || !record || record.hostId !== 'opencode' || record.session_id !== sessionId || record.call_id !== 'call-1' ||
        record.message_id !== 'message-1' || record.status !== 'completed' || record.exit !== 0 ||
        record.cwd !== undefined || record.result_digest !== crypto.createHash('sha256').update(canonical).digest('hex') ||
        record.result_bytes !== Buffer.byteLength(canonical) || fs.readFileSync(journal, 'utf8').includes('private-result-body')) {
      findings.push(`native result was not retained as one host-labelled digest-only record: ${JSON.stringify(record)}`);
    }
    if (!errorRecord || errorRecord.hostId !== 'opencode' || errorRecord.call_id !== 'call-2' ||
        errorRecord.error?.name !== 'NativeError' || errorRecord.error?.message !== 'native command error' ||
        errorRecord.error?.code !== 'NATIVE_FAILURE' || errorRecord.exit === 0) {
      findings.push(`native error was not preserved as failure without fabricated exit zero: ${JSON.stringify(errorRecord)}`);
    }

    await plugin.stream.dispatch({ type: 'session.idle', sessionID: sessionId });
    const reportPath = path.join(sessionDir, 'doc-reconciliation-pilot.json');
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
    if (assessmentSessions.filter(id => id === sessionId).length !== 1) {
      findings.push(`idle Stop dispatch count=${assessmentSessions.filter(id => id === sessionId).length}, expected exactly one`);
    }
    if (!report || report.pilotCredit !== false || report.pilotStatus !== 'unresolved' || !report.diagnostics?.length) {
      findings.push(`idle did not write the actual refused/unavailable report: ${JSON.stringify(report)}`);
    }
    assert.deepEqual(findings, []);
  } finally {
    if (dispose) dispose();
    if (originalAssess) require(PILOT).assess = originalAssess;
    fixture.cleanup();
    restoreEnv();
  }
});

test('session idle dispatches the real consumer once across every existing early return', async () => {
  const fixture = makeFixture();
  let dispose;
  const findings = [];
  const pilot = require(PILOT);
  const originalAssess = pilot.assess;
  const assessmentSessions = [];
  pilot.assess = function (context, ...args) {
    assessmentSessions.push(context?.sessionId);
    return originalAssess.call(this, context, ...args);
  };
  try {
    const plugin = await startPlugin(fixture.root);
    dispose = plugin.dispose;
    const cases = [
      ['follow-up-pending', { followUpPending: true }],
      ['follow-up-delivery-pending', { followUpDeliveryPending: true, followUpMessage: 'deliver once' }],
      ['no-verification-pending', { verificationPending: false, editsSinceVerification: 0 }],
      ['verification-succeeds', { verificationPending: true, editsSinceVerification: 1 }],
    ];
    for (const [suffix, state] of cases) {
      const sessionId = `idle-${suffix}`;
      const { sessionDir } = seedWorkflow(fixture, sessionId);
      writeEditState(sessionDir, state);
      await plugin.stream.dispatch({ type: 'session.idle', sessionID: sessionId });
      const reportPath = path.join(sessionDir, 'doc-reconciliation-pilot.json');
      const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
      if (assessmentSessions.filter(id => id === sessionId).length !== 1) {
        findings.push(`${suffix}: consumer assessment count=${assessmentSessions.filter(id => id === sessionId).length}, expected exactly one`);
      }
      if (!report || report.pilotCredit !== false || report.pilotStatus !== 'unresolved') {
        findings.push(`${suffix}: expected one refused/unavailable report, received ${JSON.stringify(report)}`);
      }
    }
    const cleanupSession = 'idle-no-verification-pending';
    await plugin.stream.dispatch({ type: 'session.idle', sessionID: cleanupSession });
    if (assessmentSessions.filter(id => id === cleanupSession).length !== 2) {
      findings.push(`finally did not release the per-session idle guard for a second event: ${assessmentSessions.filter(id => id === cleanupSession).length} assessments`);
    }
    assert.deepEqual(findings, []);
  } finally {
    if (dispose) dispose();
    pilot.assess = originalAssess;
    fixture.cleanup();
    restoreEnv();
  }
});

test('V1/no-status, pilot-OFF, no-workflow, and Claude host controls stay fail-closed', async () => {
  const fixture = makeFixture();
  let dispose;
  try {
    const plugin = await startPlugin(fixture.root);
    dispose = plugin.dispose;

    const v1Session = 'v1-no-status';
    const { sessionDir: v1Dir } = seedWorkflow(fixture, v1Session);
    await plugin.registered.get('execute.after')({
      tool: 'edit', sessionID: v1Session, id: 'v1-call', input: { filePath: path.join(fixture.root, 'docs/adr/GRPH-001.md') },
    });
    assert.equal(fs.existsSync(path.join(v1Dir, 'opencode-captures.jsonl')), false, 'V1/no-status output must not create a native capture');

    const noWorkflow = 'no-workflow';
    const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
    const noWorkflowDir = getSessionDir(fixture.root, noWorkflow, { session_id: noWorkflow, cwd: fixture.root, host_id: 'opencode' });
    await plugin.stream.dispatch({ type: 'session.idle', sessionID: noWorkflow });
    assert.equal(fs.existsSync(path.join(noWorkflowDir, 'doc-reconciliation-pilot.json')), false, 'no workflow must not write a pilot report');

    const offSession = 'pilot-off';
    const { sessionDir: offDir } = seedWorkflow(fixture, offSession);
    process.env.HARNESS_DOC_RECONCILIATION_PILOT = '0';
    await plugin.stream.dispatch({ type: 'session.idle', sessionID: offSession });
    assert.equal(fs.existsSync(path.join(offDir, 'doc-reconciliation-pilot.json')), false, 'pilot OFF must not write a reconciliation report');

    const { createClaudeOriginProvider } = require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-provider.js'));
    const claudeProvider = createClaudeOriginProvider({ hostId: 'opencode', sessionId: 'native-host-control' });
    const claudeContext = claudeProvider.resolveContext({ workspaceRoot: fixture.root });
    assert.equal(claudeContext.status, 'unavailable', 'OpenCode must not enter through Claude provider semantics');
    assert.ok(claudeContext.diagnostics.some(item => item.code === 'unsupported-host'));
  } finally {
    if (dispose) dispose();
    fixture.cleanup();
    restoreEnv();
  }
});

const OPENCODE_SESSION = 'provider-session';
const OPENCODE_QUALIFICATION = {
  source: 'fake-test-fixture', faked: true, toolUseIdPopulated: true, agentIdPopulated: true,
};

function opencodeCapture(overrides = {}) {
  return {
    schema: 'opencode-capture-record/1', hostId: 'opencode', session_id: OPENCODE_SESSION,
    call_id: 'provider-call', tool: 'bash', command: 'npm test', cwd: ROOT,
    status: 'completed', exit: 0, result_digest: 'a'.repeat(64), result_bytes: 1,
    observedIdentity: { workflowId: 'provider-workflow', workflowRevision: 3, baselinePin: null },
    ...overrides,
  };
}

function opencodeProvider(captures, overrides = {}) {
  const { createOpencodeOriginProvider } = require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-provider.js'));
  return createOpencodeOriginProvider({
    hostId: 'opencode', sessionId: OPENCODE_SESSION, workspaceRoot: ROOT,
    workflowId: 'provider-workflow', workflowRevision: 3, taskId: 'provider-task',
    principals: { author: 'provider-author', executors: ['provider-executor'] },
    qualification: OPENCODE_QUALIFICATION, captures,
    ...overrides,
  });
}

function diagnosticCode(result) { return result.diagnostics?.[0]?.code; }

test('fake-DI OpenCode origin accepts the complete native execution record shape', () => {
  const provider = opencodeProvider([opencodeCapture({ unrecognizedPrivateField: 'must-not-leak' })]);
  const context = provider.resolveContext({ workspaceRoot: ROOT });
  const result = provider.resolveEvent({
    reference: 'provider-call',
    identity: { workspaceId: 'ws-provider', sessionId: OPENCODE_SESSION, workflowId: 'provider-workflow', workflowRevision: 3 },
  });
  assert.equal(context.status, 'accepted');
  assert.match(context.originRef, /^origin:\/\/opencode\//);
  assert.equal(context.context.activeHost, 'opencode');
  assert.equal(result.status, 'accepted');
  assert.equal(result.originRef, context.originRef);
  assert.equal(result.event.originRef, context.originRef);
  assert.deepEqual(Object.keys(result.event).sort(), [
    'argv', 'artifactDigests', 'captured', 'capability', 'command', 'cwd', 'endIdentity', 'eventId',
    'exitCode', 'identity', 'kind', 'originRef', 'paths', 'principalId', 'producerId', 'provenance', 'resultRef',
    'signal', 'startIdentity', 'toolCorrelationId',
  ].sort());
  assert.equal(result.event.producerId, 'opencode-origin-provider');
  assert.equal(result.event.capability, 'shell-command');
  assert.equal(result.event.kind, 'execution');
  assert.equal(result.event.exitCode, 0);
  assert.equal(result.event.cwd, ROOT);
  assert.equal(result.event.toolCorrelationId, 'provider-call');
  assert.equal(result.event.captured.responseDigest, 'a'.repeat(64));
  assert.deepEqual(result.correlation, { toolCorrelationId: 'provider-call', resultRef: result.event.resultRef });

  const emptyResultDigest = crypto.createHash('sha256').update('').digest('hex');
  const minimum = opencodeProvider([opencodeCapture({ call_id: 'empty-result', result_digest: emptyResultDigest, result_bytes: 0 })])
    .resolveEvent({ reference: 'empty-result', identity: { workflowId: 'provider-workflow' } });
  assert.equal(minimum.status, 'accepted', 'zero result bytes are the valid minimum boundary');
  assert.equal(minimum.event.captured.responseDigest, emptyResultDigest);
});

test('production OpenCode qualification remains unmet with otherwise valid origin input', () => {
  const provider = opencodeProvider([opencodeCapture()], { qualification: undefined });
  const context = provider.resolveContext({ workspaceRoot: ROOT });
  const result = provider.resolveEvent({ reference: 'provider-call', identity: { workflowId: 'provider-workflow' } });
  assert.equal(context.status, 'unavailable');
  assert.equal(diagnosticCode(context), 'live-gate-unmet');
  assert.equal(result.status, 'unavailable');
  assert.equal(diagnosticCode(result), 'live-gate-unmet');
});

test('OpenCode provider rejects native error, incomplete outcome, and missing cwd', () => {
  const cases = [
    ['native-error', { error: { name: 'Error', message: 'failed' } }, 'failure-not-credited', 'provider-call'],
    ['missing-status', { status: undefined }, 'outcome-ambiguous', 'provider-call'],
    ['empty-status', { status: '' }, 'outcome-ambiguous', 'provider-call'],
    ['null-status', { status: null }, 'outcome-ambiguous', 'provider-call'],
    ['wrong-type-status', { status: 1 }, 'outcome-ambiguous', 'provider-call'],
    ['ambiguous-status', { status: 'running' }, 'outcome-ambiguous', 'provider-call'],
    ['missing-process-exit', { exit: undefined }, 'outcome-ambiguous', 'provider-call'],
    ['negative-result-bytes', { result_bytes: -1 }, 'stdout-withheld', 'provider-call'],
    ['missing-doc-check-cwd', { cwd: undefined, command: 'node harness-everything/scripts/doc-check.js' }, 'unregistered-command', 'provider-call#doc-lint'],
  ];
  for (const [name, changes, expected, reference] of cases) {
    const result = opencodeProvider([opencodeCapture(changes)]).resolveEvent({ reference, identity: { workflowId: 'provider-workflow' } });
    assert.equal(result.status, 'rejected', `${name}: ${JSON.stringify(result)}`);
    assert.equal(diagnosticCode(result), expected, name);
  }
});

test('OpenCode provider rejects malformed references and unsupported host input', () => {
  const invalidReference = opencodeProvider([opencodeCapture()]).resolveEvent({ reference: '' });
  assert.equal(invalidReference.status, 'unavailable');
  assert.equal(diagnosticCode(invalidReference), 'invalid-input');

  const unsupportedContext = opencodeProvider([], { hostId: 'codex' }).resolveContext({ workspaceRoot: ROOT });
  assert.equal(unsupportedContext.status, 'unavailable');
  assert.equal(diagnosticCode(unsupportedContext), 'unsupported-host');

  const unsupportedEvent = opencodeProvider([], { hostId: 'claude-code' }).resolveEvent({ reference: 'provider-call' });
  assert.equal(unsupportedEvent.status, 'unavailable');
  assert.equal(diagnosticCode(unsupportedEvent), 'unsupported-host');
});

test('OpenCode provider rejects stale, replayed, and Claude-origin records', () => {
  const identity = { workflowId: 'provider-workflow', workflowRevision: 3 };
  const stale = opencodeCapture({ observedIdentity: { workflowId: 'provider-workflow', workflowRevision: 2, baselinePin: null } });
  assert.equal(diagnosticCode(opencodeProvider([stale]).resolveEvent({ reference: stale.call_id, identity })), 'identity-mismatch');

  const first = opencodeCapture({ call_id: 'first-call' });
  const replay = opencodeCapture({ call_id: 'replayed-call' });
  const replayProvider = opencodeProvider([first, replay]);
  assert.equal(diagnosticCode(replayProvider.resolveEvent({ reference: replay.call_id, identity })), 'replayed-record');

  const claudeRecord = opencodeCapture({ hostId: 'claude-code' });
  assert.equal(diagnosticCode(opencodeProvider([claudeRecord]).resolveEvent({ reference: claudeRecord.call_id, identity })), 'record-origin-mismatch');
});

test('OpenCode quality-review record is refused when reviewer equals the author', () => {
  const record = opencodeCapture({ agent_id: 'provider-author' });
  const result = opencodeProvider([record]).resolveEvent({ reference: `${record.call_id}#quality-review` });
  assert.equal(result.status, 'rejected');
  assert.equal(diagnosticCode(result), 'reviewer-not-independent');
});
