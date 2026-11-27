'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createV2Driver } = require('./lib/opencode-v2-driver');

const ROOT = path.resolve(__dirname, '..');
const STOP_GATE = path.join(ROOT, 'hooks/scripts/workflow-stop-gate.js');
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_WORKSPACE_ROOT', 'HARNESS_DOC_RECONCILIATION_PILOT', 'HARNESS_TELEMETRY'].map(key => [key, process.env[key]]));

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

function initWorkspace(root) {
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
}

function makeFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-opencode-workspace-')));
  const stateHome = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-opencode-state-')));
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-opencode-home-')));
  initWorkspace(root);
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

function seedWorkflow(rootOrFixture, sessionId) {
  const root = typeof rootOrFixture === 'string' ? rootOrFixture : rootOrFixture.root;
  const payload = { session_id: sessionId, cwd: root, host_id: 'opencode' };
  const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
  const sessionDir = getSessionDir(root, sessionId, payload);
  const plan = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
  const context = {
    root,
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

async function withV2DocFixture(fn, options = {}) {
  const d = await createV2Driver(options);
  const pilotSaved = Object.fromEntries(['HARNESS_WORKSPACE_ROOT', 'HARNESS_DOC_RECONCILIATION_PILOT', 'HARNESS_TELEMETRY'].map(key => [key, process.env[key]]));
  try {
    initWorkspace(d.workspace);
    process.env.HARNESS_WORKSPACE_ROOT = d.workspace;
    process.env.HARNESS_TELEMETRY = 'local';
    if (options.pilotFlag === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
    else process.env.HARNESS_DOC_RECONCILIATION_PILOT = options.pilotFlag;
    return await fn(d);
  } finally {
    for (const [key, value] of Object.entries(pilotSaved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await d.teardown();
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readTelemetryEvents(sessionDir) {
  const file = path.join(path.dirname(path.dirname(sessionDir)), 'telemetry', 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function readObservationRecords(observationsDir) {
  const file = path.join(observationsDir, 'observations-index.json');
  return fs.existsSync(file) ? readJson(file).records : [];
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('existing Stop consumer runs ordinary workflow Stop without writing an E1 pilot report', () => {
  for (const [label, pilotFlag] of [['pilot-1', '1'], ['pilot-unset', undefined]]) {
    const fixture = makeFixture();
    try {
      if (pilotFlag === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
      else process.env.HARNESS_DOC_RECONCILIATION_PILOT = pilotFlag;
      const control = seedWorkflow(fixture, `stop-positive-control-${label}`);
      const result = runJson(STOP_GATE, fixture.root, control.payload);
      const reportPath = path.join(control.sessionDir, 'doc-reconciliation-pilot.json');
      const workflow = readJson(path.join(control.sessionDir, 'workflow-run.json'));
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.match(result.stderr, /\[Workflow Reminder\] Unresolved workflow evidence:/, `${label}: ordinary Stop reminder still fires`);
      assert.ok(Array.isArray(workflow.unresolved) && workflow.unresolved.length > 0, `${label}: ordinary Stop records unresolved obligations`);
      assert.equal(fs.existsSync(reportPath), false, `${label}: Stop must not write doc-reconciliation-pilot.json`);
    } finally {
      fixture.cleanup();
      restoreEnv();
    }
  }
});

test('V2 execute.after writes no E1 journal while ordinary telemetry, edit, observation, and Stop remain active', async () => {
  for (const [label, pilotFlag] of [['pilot-1', '1'], ['pilot-unset', undefined]]) {
    await withV2DocFixture(async d => {
      const sessionId = `native-v2-unhooked-${label}`;
      const { sessionDir } = seedWorkflow(d.workspace, sessionId);
      const observationsDir = process.env.HARNESS_OBSERVATIONS_DIR;

      await d.sessionHook('prompt')({
        sessionID: sessionId,
        messageID: `turn-${label}`,
        prompt: { text: 'update retry doc and verify' },
      });

      const skillEvent = { tool: 'skill', sessionID: sessionId, id: 'call-skill', messageID: 'msg-skill', input: { skill: 'tdd' } };
      await d.toolHook('execute.before')(skillEvent);
      await d.toolHook('execute.after')({ ...skillEvent, status: 'completed', result: { output: 'loaded' } });

      const editEvent = {
        tool: 'edit', sessionID: sessionId, id: 'call-edit', messageID: 'msg-edit',
        input: { filePath: path.join(d.workspace, 'docs/adr/GRPH-001.md') },
      };
      await d.toolHook('execute.before')(editEvent);
      await d.toolHook('execute.after')({ ...editEvent, status: 'completed', result: { output: 'ok', metadata: { exit: 0 } } });

      const bashEvent = {
        tool: 'bash', sessionID: sessionId, id: 'call-bash', messageID: 'msg-bash',
        input: { command: 'doc-check' },
      };
      await d.toolHook('execute.before')(bashEvent);
      await d.toolHook('execute.after')({
        ...bashEvent, status: 'completed',
        error: { name: 'NativeError', message: 'native command error', code: 'NATIVE_FAILURE' },
      });

      // Path-specific sentinel: E1 host capture journal must not be created.
      const journal = path.join(sessionDir, 'opencode-captures.jsonl');
      assert.equal(fs.existsSync(journal), false, `${label}: V2 execute.after must not write opencode-captures.jsonl`);

      // Positive controls: ordinary edit state, compliance, and telemetry remain active.
      const editState = readJson(path.join(sessionDir, 'edit-state.json'));
      const compliance = readJson(path.join(sessionDir, 'compliance.json'));
      assert.equal(editState.verificationPending, true, `${label}: edit marks verificationPending`);
      assert.equal(editState.editsSinceVerification, 1, `${label}: edit increments editsSinceVerification`);
      assert.equal(compliance.totalEdits, 1, `${label}: compliance records totalEdits`);
      const preIdleTelemetry = readTelemetryEvents(sessionDir).map(item => item.event);
      assert.ok(preIdleTelemetry.includes('skill.invoke'), `${label}: telemetry records skill.invoke`);
      assert.ok(preIdleTelemetry.includes('skill.loaded'), `${label}: telemetry records skill.loaded`);
      assert.ok(preIdleTelemetry.includes('tool.observed'), `${label}: telemetry records tool.observed`);

      // Completion triggers ordinary verification, observation closure, telemetry close, and Stop without E1 report.
      const workflowFile = path.join(sessionDir, 'workflow-run.json');
      d.emit('session.execution.succeeded', sessionId);
      await d.waitFor(
        () => readObservationRecords(observationsDir).length === 1
          && readJson(path.join(sessionDir, 'edit-state.json')).verificationPending === false
          && Array.isArray(readJson(workflowFile).unresolved)
          && readJson(workflowFile).unresolved.length > 0,
        { label: `${label}: observation, verification, and ordinary Stop completion`, timeoutMs: 8000 },
      );

      const [obsRecord] = readObservationRecords(observationsDir);
      assert.equal(obsRecord.host, 'opencode', `${label}: observation host is opencode`);
      assert.equal(obsRecord.writer.sessionId, sessionId, `${label}: observation session matches`);
      assert.equal(obsRecord.behavior.filesWritten, 1, `${label}: observation counted the edit`);
      const postIdleTelemetry = readTelemetryEvents(sessionDir).map(item => item.event);
      assert.ok(postIdleTelemetry.includes('skill.complete'), `${label}: telemetry closes active skill on idle`);
      assert.equal(fs.existsSync(journal), false, `${label}: opencode-captures.jsonl remains absent after idle`);
      assert.equal(fs.existsSync(path.join(sessionDir, 'doc-reconciliation-pilot.json')), false, `${label}: no E1 pilot report after idle`);
    }, { observations: 'on', pilotFlag });
  }
});

test('session idle finally releases the controller across all four early returns and completes ordinary Stop/verification/reminder paths', async () => {
  await withV2DocFixture(async d => {
    const cases = [
      ['follow-up-pending', { followUpPending: true }],
      ['follow-up-delivery-pending', { followUpDeliveryPending: true, followUpMessage: 'deliver once' }],
      ['no-verification-pending', { verificationPending: false, editsSinceVerification: 0 }],
      ['verification-succeeds', { verificationPending: true, editsSinceVerification: 1 }],
    ];
    for (const [suffix, state] of cases) {
      const sessionId = `idle-${suffix}`;
      const { sessionDir } = seedWorkflow(d.workspace, sessionId);
      const workflowFile = path.join(sessionDir, 'workflow-run.json');
      const editStateFile = path.join(sessionDir, 'edit-state.json');
      writeEditState(sessionDir, state);

      const promptsBefore = d.prompts.length;
      d.emit('session.execution.succeeded', sessionId);
      await d.waitFor(
        () => Array.isArray(readJson(workflowFile).unresolved) && readJson(workflowFile).unresolved.length > 0,
        { label: `${suffix}: ordinary Stop ran on first idle`, timeoutMs: 8000 },
      );

      const afterFirst = readJson(editStateFile);
      if (suffix === 'follow-up-pending') {
        assert.equal(d.prompts.length, promptsBefore, `${suffix}: no duplicate prompt sent`);
      } else if (suffix === 'follow-up-delivery-pending') {
        assert.equal(d.prompts.length, promptsBefore + 1, `${suffix}: pending reminder prompt delivered`);
        assert.equal(d.prompts.at(-1).sessionID, sessionId);
        assert.equal(d.prompts.at(-1).text, 'deliver once');
        assert.equal(afterFirst.followUpPending, true);
        assert.equal(afterFirst.followUpDeliveryPending, false);
      } else if (suffix === 'no-verification-pending') {
        assert.equal(d.prompts.length, promptsBefore, `${suffix}: no prompt sent without pending verification`);
      } else if (suffix === 'verification-succeeds') {
        assert.equal(afterFirst.verificationPending, false, `${suffix}: passing verification clears verificationPending`);
        assert.equal(afterFirst.editsSinceVerification, 0, `${suffix}: passing verification resets editsSinceVerification`);
        assert.equal(readJson(path.join(sessionDir, 'compliance.json')).verifiedEdits, 1, `${suffix}: compliance increments verifiedEdits`);
      }

      assert.equal(fs.existsSync(path.join(sessionDir, 'doc-reconciliation-pilot.json')), false, `${suffix}: no E1 pilot report`);
      assert.equal(fs.existsSync(path.join(sessionDir, 'opencode-captures.jsonl')), false, `${suffix}: no E1 capture journal`);

      // Prove finally released the per-session controller: clear workflow.unresolved and fire a second idle.
      const wf = readJson(workflowFile);
      wf.unresolved = [];
      fs.writeFileSync(workflowFile, JSON.stringify(wf, null, 2));
      d.emit('session.execution.succeeded', sessionId);
      await d.waitFor(
        () => Array.isArray(readJson(workflowFile).unresolved) && readJson(workflowFile).unresolved.length > 0,
        { label: `${suffix}: second idle runs after finally releases controller`, timeoutMs: 8000 },
      );
    }
  }, { pilotFlag: '1' });
});

test('pilot flag values and no-workflow stay unhooked and fail-closed', async () => {
  await withV2DocFixture(async d => {
    for (const [label, pilotFlag] of [['pilot-1', '1'], ['pilot-0', '0'], ['pilot-unset', undefined]]) {
      if (pilotFlag === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
      else process.env.HARNESS_DOC_RECONCILIATION_PILOT = pilotFlag;
      const sessionId = `flag-control-${label}`;
      const { sessionDir } = seedWorkflow(d.workspace, sessionId);
      await d.toolHook('execute.after')({
        tool: 'edit', sessionID: sessionId, id: `call-${label}`, status: 'completed',
        result: { output: 'ok', metadata: { exit: 0 } },
        input: { filePath: path.join(d.workspace, 'docs/adr/GRPH-001.md') },
      });
      assert.equal(fs.existsSync(path.join(sessionDir, 'edit-state.json')), true, `${label}: positive control edit-state written`);
      assert.equal(fs.existsSync(path.join(sessionDir, 'opencode-captures.jsonl')), false, `${label}: V2 execute.after must not write opencode-captures.jsonl`);
    }

    const noWorkflow = 'no-workflow';
    const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
    const noWorkflowDir = getSessionDir(d.workspace, noWorkflow, { session_id: noWorkflow, cwd: d.workspace, host_id: 'opencode' });
    process.env.HARNESS_DOC_RECONCILIATION_PILOT = '1';
    d.emit('session.execution.succeeded', noWorkflow);
    await d.settled({ quietMs: 150 });
    assert.equal(fs.existsSync(path.join(noWorkflowDir, 'doc-reconciliation-pilot.json')), false, 'no workflow must not write a pilot report');
    assert.equal(fs.existsSync(path.join(noWorkflowDir, 'workflow-run.json')), false, 'no workflow must not create a workflow file');
  }, { pilotFlag: '1' });
});

