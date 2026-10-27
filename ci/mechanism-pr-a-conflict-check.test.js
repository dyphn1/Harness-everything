#!/usr/bin/env node
'use strict';

// PR-A RED/GREEN contract for the full-corpus conflict-check producer.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DOC_CHECK = path.join(ROOT, 'harness-everything', 'scripts', 'doc-check.js');
const PROVIDER = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'doc-reconciliation-provider.js'));
const PILOT = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'doc-reconciliation-pilot.js'));
const PRODUCER = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'doc-reconciliation-producer.js'));
const EVENTS = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'doc-reconciliation-events.js'));
const EVIDENCE = require(path.join(ROOT, 'harness-everything', 'scripts', 'doc-evidence.js'));
const LIFECYCLE = require(path.join(ROOT, 'harness-everything', 'scripts', 'doc-lifecycle.js'));
const REQUIREMENTS = [
  { id: 'req-docs', stepType: 'doc-change', summary: 'Update the ADR', acceptance: 'the normative change is reviewed' },
  { id: 'req-verify', stepType: 'verification', summary: 'Verify the ADR', acceptance: 'full-corpus conflict evidence is recorded' },
];
const PILOT_CONFIG_TEXT = JSON.stringify({
  governed: [{ path: 'docs/current/**', role: 'adr' }], legacy: [], domains: ['GRPH'],
}, null, 2) + '\n';
const CONFIG = '.agents/harness-everything/project-docs.json';
const CONFIG_TEXT = JSON.stringify({
  governed: [{ path: 'docs/current/**', role: 'reference' }],
  legacy: ['docs/legacy/**'],
  domains: ['GRPH', 'LEG'],
}, null, 2) + '\n';

const roots = [];
function write(root, relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function git(root, args) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function reference(id, extra = '') {
  return `---\nrole: reference\nstatus: active\nid: ${id}\n${extra}---\n\n# ${id}\n\nA governed document.\n`;
}
function adr(id, body) {
  return `---\nid: ${id}\nrole: adr\nstatus: accepted\n---\n\n# ${id}\n\n## Decision\n\n${body}\n`;
}
function workspace(files, configText = CONFIG_TEXT) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pra-conflict-check-')));
  roots.push(root);
  write(root, CONFIG, configText);
  for (const [relative, contents] of Object.entries(files)) write(root, relative, contents);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'baseline']);
  return { root, base: git(root, ['rev-parse', 'HEAD']) };
}
function runCheck(root, base, changed = ['docs/current/a.md'], extra = []) {
  return spawnSync(process.execPath, [DOC_CHECK, 'check', '--workspace', root, '--config', CONFIG,
    ...changed.flatMap(item => ['--changed-path', item]), '--base', base, ...extra],
  { cwd: root, encoding: 'utf8' });
}
function report(result) {
  try { return JSON.parse(result.stdout); } catch { return null; }
}
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

function seedPilotScenario() {
  const baselineDoc = adr('GRPH-001', 'Checkout retries once.');
  const { root, base } = workspace({
    'docs/current/a.md': baselineDoc,
    'docs/current/b.md': adr('GRPH-002', 'The receipt is durable.'),
  }, PILOT_CONFIG_TEXT);
  write(root, 'docs/current/a.md', adr('GRPH-001', 'Checkout retries twice.'));
  const sessionId = 'pra-session';
  const workflowId = 'pra-workflow';
  const sessionDir = path.join(root, '.harness-session');
  fs.mkdirSync(sessionDir, { recursive: true });
  const plan = { strategySelection: 'selected', tier: 'tier2', strategy: 'iterative-single' };
  const context = {
    sessionId, sessionDir, root,
    workflow: { workflowId, revision: 1, state: 'pending', strategy: 'iterative-single', workflowPlan: plan },
  };
  const obligations = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'workflow-obligations.js'));
  obligations.initializePlanningContract(context, plan);
  obligations.recordPlanning(context, JSON.stringify(REQUIREMENTS), plan, 'iterative-single', 'one bounded documentation verification path');
  obligations.materializeExecutionObligations(context, plan);
  const loaded = obligations.loadObligationSet(context, plan);
  if (!loaded.set) throw new Error(`pilot fixture failed to load obligations: ${loaded.error}`);
  context.workflow.docReconciliationBaseline = { root, commit: base };
  write(sessionDir, 'workflow-run.json', JSON.stringify({ workflowId, revision: 1, docReconciliationBaseline: context.workflow.docReconciliationBaseline }));
  return { root, base, context, plan, set: loaded.set, sessionId, workflowId, sessionDir };
}

function addHostCapture(scenario, payload, eventName = 'PostToolUse') {
  const capture = PROVIDER.buildCaptureRecord(payload, eventName, scenario.root);
  if (!capture) throw new Error(`capture builder did not accept ${eventName}`);
  capture.observedIdentity = PROVIDER.observedIdentityFor(scenario.sessionDir);
  PROVIDER.writeImmutableEvent(scenario.sessionDir, capture);
  PROVIDER.rebuildJournalView(scenario.sessionDir);
  return capture;
}

function addAssessmentCapture(scenario, changed = ['docs/current/a.md'], beforeCapture = null) {
  const args = [DOC_CHECK, 'check', '--workspace', scenario.root, '--config', CONFIG,
    ...changed.flatMap(item => ['--changed-path', item]), '--base', scenario.base, '--conflict-assessment'];
  const result = spawnSync(process.execPath, args, { cwd: scenario.root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`fixture assessment failed with ${result.status}: ${report(result)?.conflictAssessment?.reason || result.stderr}`);
  if (beforeCapture) beforeCapture();
  const command = ['node', ...args].join(' ');
  return { result, capture: addHostCapture(scenario, {
    cwd: scenario.root, session_id: scenario.sessionId, tool_name: 'Bash', tool_use_id: 'check-1',
    tool_input: { command }, tool_response: { stdout: result.stdout, interrupted: false },
  }) };
}

function addReviewCapture(scenario) {
  const reviewer = 'independent-reviewer';
  addHostCapture(scenario, {
    cwd: scenario.root, session_id: scenario.sessionId, tool_name: 'Task', tool_use_id: 'review-task',
    tool_input: { description: 'Read-only ADR review' }, tool_response: { agentId: reviewer, interrupted: false },
  });
  const digest = sha(fs.readFileSync(path.join(scenario.root, 'docs/current/a.md')));
  addHostCapture(scenario, {
    cwd: scenario.root, session_id: scenario.sessionId, tool_use_id: 'review-stop', agent_id: reviewer, agent_type: 'general-purpose',
    last_assistant_message: `Review verdict: approve\nThe updated ADR is clear.\nReviewed artifact: docs/current/a.md sha256:${digest}`,
  }, 'SubagentStop');
}

function testOrigin(scenario, captures = PROVIDER.readCaptureView(scenario.sessionDir).records) {
  return PROVIDER.createClaudeOriginProvider({
    hostId: 'claude-code', sessionId: scenario.sessionId, workspaceRoot: scenario.root,
    workflowId: scenario.workflowId, workflowRevision: 1,
    taskId: `task-${REQUIREMENTS.map(item => item.id).join('+')}`,
    principals: { author: scenario.sessionId, executors: [scenario.sessionId] },
    baseline: scenario.context.workflow.docReconciliationBaseline,
    captures,
    qualification: { source: 'fake-test-fixture', faked: true, ref: 'pra-fixture', toolUseIdPopulated: true, agentIdPopulated: true },
  });
}

function providerIdentity(scenario) {
  return {
    workspaceId: 'pra-workspace', sessionId: scenario.sessionId, workflowId: scenario.workflowId,
    workflowRevision: 1, taskId: `task-${REQUIREMENTS.map(item => item.id).join('+')}`,
    taskScopeDigest: '1'.repeat(64), baselineDigest: '2'.repeat(64), candidateDigest: '3'.repeat(64),
    configDigest: '4'.repeat(64), prdRoot: 'docs/prd/',
  };
}

function produceSnapshot(scenario, origin = testOrigin(scenario)) {
  const result = PRODUCER.produceDocSnapshot({
    workspaceRoot: scenario.root, baseline: scenario.context.workflow.docReconciliationBaseline,
    workflow: { workflowId: scenario.workflowId, workflowRevision: 1, sessionId: scenario.sessionId },
    task: { taskId: `task-${REQUIREMENTS.map(item => item.id).join('+')}`, requirements: REQUIREMENTS },
    scope: { prdRoot: 'docs/prd/' }, activeHost: 'claude-code', prdRoot: 'docs/prd/',
  }, { originProvider: origin });
  if (result.state !== 'ready' || !result.snapshot) throw new Error(`pilot snapshot unavailable: ${JSON.stringify(result.diagnostics)}`);
  return result.snapshot;
}

let passed = 0;
let failed = 0;
function check(id, fn) {
  try { fn(); passed += 1; console.log(`PASS ${id}`); }
  catch (error) { failed += 1; console.error(`FAIL ${id} — ${error.message.split('\n')[0]}`); }
}

try {
  check('F1 full clean corpus emits a bound conflict-check projection', () => {
    const docs = {
      'docs/current/a.md': reference('GRPH-001'),
      'docs/current/b.md': reference('GRPH-002'),
      'docs/legacy/LEG-001.md': reference('LEG-001'),
    };
    const { root, base } = workspace(docs);
    const result = runCheck(root, base, ['docs/current/a.md'], ['--conflict-assessment']);
    const out = report(result);
    assert.equal(result.status, 0, `expected clean assessment exit 0, got ${result.status}: ${out?.lint?.error || result.stderr}`);
    assert.equal(out.mode, 'conflict-assessment');
    assert.equal(out.capabilities['conflict-check'].state, 'pass');
    assert.deepEqual(out.capabilities['conflict-check'].checkedPaths, ['docs/current/a.md']);
    assert.deepEqual(out.capabilities['conflict-check'].corpus.paths, Object.keys(docs).sort());
    assert.deepEqual(out.capabilities['conflict-check'].corpus.digests, Object.fromEntries(Object.entries(docs).map(([p, text]) => [p, sha(text)])));
    assert.equal(out.capabilities['conflict-check'].corpus.config.path, CONFIG);
    assert.equal(out.capabilities['conflict-check'].corpus.config.digest, sha(fs.readFileSync(path.join(root, CONFIG))));
    assert.equal(out.capabilities['conflict-check'].corpus.baseCommit, base);
  });

  check('F2 plain changed-path check cannot produce conflict-check credit for unchanged conflicts', () => {
    const { root, base } = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [GRPH-002]\n'),
      'docs/current/b.md': reference('GRPH-002'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const result = runCheck(root, base, ['docs/current/probe.md']);
    const out = report(result);
    assert.equal(result.status, 0, `unchanged conflict must stay a warning in plain check, got ${result.status}`);
    assert.equal(out.capabilities['doc-lint'].state, 'pass');
    assert.equal(out.capabilities['link-check'].state, 'pass');
    assert.equal(out.capabilities['conflict-check'], undefined);
    const command = `node ${DOC_CHECK} check --workspace ${root} --config ${CONFIG} --changed-path docs/current/probe.md --base ${base}`;
    const invocation = PROVIDER.resolveDocCheckInvocation(command, root);
    assert.equal(invocation.kind, 'accepted');
    assert.notEqual(invocation.conflictAssessment, true);
  });

  check('F3 full assessment rejects recorded conflicts on unchanged files', () => {
    const { root, base } = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [GRPH-002]\n'),
      'docs/current/b.md': reference('GRPH-002'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const result = runCheck(root, base, ['docs/current/probe.md'], ['--conflict-assessment']);
    const out = report(result);
    assert.equal(result.status, 1, `full lint should reject recorded conflict, got ${result.status}`);
    assert.ok(out.lint.diagnostics.some(item => item.code === 'recorded-conflict'));
    assert.notEqual(out.capabilities?.['conflict-check']?.state, 'pass');
  });

  check('assessment flag is structurally parsed and accepted by the provider', () => {
    const { root, base } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const command = `node ${DOC_CHECK} check --workspace ${root} --config ${CONFIG} --changed-path docs/current/a.md --base ${base} --conflict-assessment`;
    const invocation = PROVIDER.resolveDocCheckInvocation(command, root);
    assert.equal(invocation.kind, 'accepted', `provider rejected structured assessment argv: ${invocation.reason}`);
    assert.equal(invocation.conflictAssessment, true);
    assert.equal(invocation.base, base);
  });

  check('duplicate assessment flag is rejected as a duplicate', () => {
    const { root, base } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const result = runCheck(root, base, ['docs/current/a.md'], ['--conflict-assessment', '--conflict-assessment']);
    const out = report(result);
    assert.equal(result.status, 2);
    assert.match(out.lint.error, /repeated argument: --conflict-assessment/);
  });

  check('assessment mode requires its baseline pin', () => {
    const { root, base } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const args = [DOC_CHECK, 'check', '--workspace', root, '--config', CONFIG, '--changed-path', 'docs/current/a.md', '--conflict-assessment'];
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(report(result).lint.error, /--conflict-assessment requires --base/);
    const command = `node ${DOC_CHECK} check --workspace ${root} --config ${CONFIG} --changed-path docs/current/a.md --conflict-assessment`;
    assert.equal(PROVIDER.resolveDocCheckInvocation(command, root).reason, 'conflict-assessment-base-required');
    const unpinned = runCheck(root, 'HEAD', ['docs/current/a.md'], ['--conflict-assessment']);
    assert.equal(report(unpinned).conflictAssessment.state, 'unavailable');
    assert.equal(report(unpinned).conflictAssessment.reason, 'base-not-pinned');
    const movingBaseCommand = `node ${DOC_CHECK} check --workspace ${root} --config ${CONFIG} --changed-path docs/current/a.md --base HEAD --conflict-assessment`;
    assert.equal(PROVIDER.resolveDocCheckInvocation(movingBaseCommand, root).reason, 'conflict-assessment-base-unpinned');
    assert.ok(base);
  });

  check('F4 full graph resolves cross-domain legacy targets and rejects unresolved references', () => {
    const crossDomain = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [legacy:LEG-001]\n'),
      'docs/legacy/LEG-001.md': reference('LEG-001'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const crossResult = runCheck(crossDomain.root, crossDomain.base, ['docs/current/probe.md'], ['--conflict-assessment']);
    const crossOut = report(crossResult);
    assert.equal(crossResult.status, 1);
    assert.ok(crossOut.lint.diagnostics.some(item => item.code === 'recorded-conflict' && item.path === 'docs/current/a.md'), JSON.stringify(crossOut.lint.diagnostics));
    assert.notEqual(crossOut.capabilities?.['conflict-check']?.state, 'pass');

    const unresolved = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [LEG-404]\n'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const unresolvedResult = runCheck(unresolved.root, unresolved.base, ['docs/current/probe.md'], ['--conflict-assessment']);
    const unresolvedOut = report(unresolvedResult);
    assert.equal(unresolvedResult.status, 1);
    assert.ok(unresolvedOut.lint.diagnostics.some(item => item.code === 'unresolved-ref'), JSON.stringify(unresolvedOut.lint.diagnostics));
    assert.notEqual(unresolvedOut.capabilities?.['conflict-check']?.state, 'pass');
  });

  check('omitted corpus and stale base stay unavailable', () => {
    const config = JSON.stringify({ governed: [
      { path: 'docs/current/a.md', role: 'reference' },
      { path: 'docs/current/missing.md', role: 'reference' },
    ], legacy: [], domains: ['GRPH'] }, null, 2) + '\n';
    const omitted = workspace({ 'docs/current/a.md': reference('GRPH-001') }, config);
    const incomplete = report(runCheck(omitted.root, omitted.base, ['docs/current/a.md'], ['--conflict-assessment']));
    assert.equal(incomplete.conflictAssessment.state, 'unavailable');
    assert.equal(incomplete.conflictAssessment.reason, 'corpus-incomplete');
    assert.notEqual(incomplete.capabilities?.['conflict-check']?.state, 'pass');

    const clean = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const stale = report(runCheck(clean.root, 'deadbeef', ['docs/current/a.md'], ['--conflict-assessment']));
    assert.notEqual(stale?.capabilities?.['conflict-check']?.state, 'pass');
  });

  check('mode-looking argument text is not parsed as an assessment flag', () => {
    const { root, base } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const command = `node ${DOC_CHECK} check --workspace ${root} --config ${CONFIG} --changed-path "docs/current/a.md --conflict-assessment" --base ${base}`;
    const invocation = PROVIDER.resolveDocCheckInvocation(command, root);
    assert.equal(invocation.kind, 'accepted');
    assert.notEqual(invocation.conflictAssessment, true);
  });

  check('end-to-end pilot discovers conflict-check from real capture records', () => {
    const scenario = seedPilotScenario();
    const previous = process.env.HARNESS_DOC_RECONCILIATION_PILOT;
    process.env.HARNESS_DOC_RECONCILIATION_PILOT = '1';
    try {
      const { capture } = addAssessmentCapture(scenario);
      addReviewCapture(scenario);
      const result = PILOT.assess(scenario.context, scenario.set, { originProvider: testOrigin(scenario) });
      assert.equal(result.withhold, false, JSON.stringify(result.report));
      assert.equal(result.report.pilotCredit, true);
      assert.ok(result.report.creditedCapabilities.includes('conflict-check'), JSON.stringify(result.report));
      assert.ok(result.report.acceptedRefs.includes(`${capture.ref}#conflict-check`), JSON.stringify(result.report.acceptedRefs));
    } finally {
      if (previous === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
      else process.env.HARNESS_DOC_RECONCILIATION_PILOT = previous;
    }
  });

  check('capture rejects corpus or config changes between check and PostToolUse', () => {
    const corpusChanged = seedPilotScenario();
    const changedRun = addAssessmentCapture(corpusChanged, ['docs/current/a.md'], () => {
      write(corpusChanged.root, 'docs/current/b.md', adr('GRPH-002', 'The receipt is now archived.'));
    });
    const corpusOrigin = testOrigin(corpusChanged);
    const corpusResult = corpusOrigin.resolveEvent({
      reference: `${changedRun.capture.ref}#conflict-check`, identity: providerIdentity(corpusChanged),
    });
    assert.equal(corpusResult.status, 'rejected');
    assert.ok(corpusResult.diagnostics.some(item => item.code === 'corpus-changed-after-check'));

    const configChanged = seedPilotScenario();
    const configRun = addAssessmentCapture(configChanged, ['docs/current/a.md'], () => {
      fs.appendFileSync(path.join(configChanged.root, CONFIG), '\n');
    });
    const configOrigin = testOrigin(configChanged);
    const configResult = configOrigin.resolveEvent({
      reference: `${configRun.capture.ref}#conflict-check`, identity: providerIdentity(configChanged),
    });
    assert.equal(configResult.status, 'rejected');
    assert.ok(configResult.diagnostics.some(item => item.code === 'config-changed-after-check'));
  });

  check('corpus changes after capture are rejected against the later snapshot', () => {
    const scenario = seedPilotScenario();
    const { capture } = addAssessmentCapture(scenario);
    const origin = testOrigin(scenario);
    write(scenario.root, 'docs/current/b.md', adr('GRPH-002', 'The receipt is now archived.'));
    const snapshot = produceSnapshot(scenario, origin);
    const accepted = EVENTS.acceptDocEvents({ snapshot, eventRefs: [`${capture.ref}#conflict-check`] }, { originProvider: origin });
    assert.equal(accepted.state, 'unresolved');
    assert.ok(accepted.rejected.some(item => item.code === 'corpus-mismatch'));
  });

  check('symlink skips and unreadable corpus files mark the full collection incomplete', () => {
    const { root } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const external = path.join(os.tmpdir(), `pra-outside-${process.pid}.md`);
    write(root, 'docs/current/skipped.md', reference('GRPH-002'));
    fs.writeFileSync(external, reference('GRPH-003'));
    let linked = false;
    try {
      fs.rmSync(path.join(root, 'docs/current/skipped.md'));
      fs.symlinkSync(external, path.join(root, 'docs/current/skipped.md'));
      linked = true;
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    }
    try {
      if (linked) {
      const result = report(runCheck(root, git(root, ['rev-parse', 'HEAD']), ['docs/current/a.md'], ['--conflict-assessment']));
      assert.equal(result.conflictAssessment.state, 'unavailable');
      assert.equal(result.conflictAssessment.reason, 'corpus-incomplete');
      }
    } finally {
      fs.rmSync(external, { force: true });
    }

    const target = path.join(root, 'docs/current/a.md');
    const originalRead = fs.readFileSync;
    const coverage = {};
    fs.readFileSync = function (file, ...args) {
      if (typeof file === 'string' && path.resolve(file) === target) {
        const error = new Error('fixture unreadable');
        error.code = 'EACCES';
        throw error;
      }
      return originalRead.call(this, file, ...args);
    };
    try {
      LIFECYCLE.collectDocs(root, { governed: [{ path: 'docs/current/**', role: 'reference' }], legacy: [] }, coverage);
    } finally { fs.readFileSync = originalRead; }
    assert.equal(coverage.complete, false);
    assert.ok(coverage.skipped.some(item => item.path === 'docs/current/a.md' && item.reason === 'unreadable-file'));
  });

  check('provider requires the assessment stdout schema as well as the argv mode', () => {
    const scenario = seedPilotScenario();
    const command = `node ${DOC_CHECK} check --workspace ${scenario.root} --config ${CONFIG} --changed-path docs/current/a.md --base ${scenario.base} --conflict-assessment`;
    const capture = addHostCapture(scenario, {
      cwd: scenario.root, session_id: scenario.sessionId, tool_name: 'Bash', tool_use_id: 'forged-mode',
      tool_input: { command }, tool_response: { interrupted: false, stdout: JSON.stringify({
        schema: 'forged', mode: 'conflict-assessment', lint: { exit: 0 },
        capabilities: { 'conflict-check': { state: 'pass', checkedPaths: ['docs/current/a.md'] } },
      }) },
    });
    const response = testOrigin(scenario).resolveEvent({
      reference: `${capture.ref}#conflict-check`, identity: providerIdentity(scenario),
    });
    assert.equal(response.status, 'rejected');
    assert.ok(response.diagnostics.some(item => item.code === 'check-not-passed'));
  });

  check('snapshot adapter rejects wrong scope, corpus, config, and base bindings', () => {
    const scenario = seedPilotScenario();
    const { capture } = addAssessmentCapture(scenario);
    const origin = testOrigin(scenario);
    const snapshot = produceSnapshot(scenario, origin);
    const reference = `${capture.ref}#conflict-check`;
    const accept = mutate => EVENTS.acceptDocEvents({ snapshot, eventRefs: [reference] }, {
      originProvider: {
        resolveContext: request => origin.resolveContext(request),
        resolveEvent: request => {
          const response = origin.resolveEvent(request);
          if (response.status !== 'accepted') return response;
          const event = JSON.parse(JSON.stringify(response.event));
          mutate(event);
          return { ...response, event };
        },
      },
    });

    const good = EVENTS.acceptDocEvents({ snapshot, eventRefs: [reference] }, { originProvider: origin });
    assert.equal(good.state, 'ready', JSON.stringify(good.rejected));
    for (const [name, mutate, expected] of [
      ['scope', event => { event.paths = ['docs/current/b.md']; }, 'scope-mismatch'],
      ['corpus', event => { event.corpusBinding.paths.pop(); }, 'corpus-mismatch'],
      ['config', event => { event.corpusBinding.config.digest = '0'.repeat(64); }, 'config-capture-mismatch'],
      ['base', event => { event.corpusBinding.baseCommit = '0'.repeat(40); }, 'snapshot-changed'],
    ]) {
      const output = accept(mutate);
      assert.equal(output.state, 'unresolved', `${name}: ${JSON.stringify(output.rejected)}`);
      assert.ok(output.rejected.some(item => item.code === expected), `${name}: ${JSON.stringify(output.rejected)}`);
    }
  });

  check('provider keeps replay, interruption, failure, and digest-pin controls', () => {
    const scenario = seedPilotScenario();
    const { capture } = addAssessmentCapture(scenario);
    const identity = providerIdentity(scenario);
    const duplicate = JSON.parse(JSON.stringify(capture));
    duplicate.ref = 'replayed-capture';
    const replay = testOrigin(scenario, [capture, duplicate]).resolveEvent({
      reference: 'replayed-capture#conflict-check', identity,
    });
    assert.ok(replay.diagnostics.some(item => item.code === 'replayed-record'));

    const interruptedCapture = { ...capture, interrupted: true };
    const interrupted = testOrigin(scenario, [interruptedCapture]).resolveEvent({
      reference: `${capture.ref}#conflict-check`, identity,
    });
    assert.ok(interrupted.diagnostics.some(item => item.code === 'interrupted-not-credited'));

    addHostCapture(scenario, {
      cwd: scenario.root, session_id: scenario.sessionId, tool_name: 'Bash', tool_use_id: capture.tool_use_id,
      tool_input: { command: capture.command }, error: 'Exit code 1',
    }, 'PostToolUseFailure');
    const failedInvocation = testOrigin(scenario).resolveEvent({
      reference: `${capture.ref}#conflict-check`, identity,
    });
    assert.ok(failedInvocation.diagnostics.some(item => item.code === 'failure-invalidates-mapping'));

    const stalePinCapture = { ...capture, implementationDigest: '0'.repeat(64) };
    const stalePin = testOrigin(scenario, [stalePinCapture]).resolveEvent({
      reference: `${capture.ref}#conflict-check`, identity,
    });
    assert.ok(stalePin.diagnostics.some(item => item.code === 'implementation-digest-mismatch'));
  });

  check('a waiver without a successful complete assessment cannot PASS conflict-check', () => {
    const scope = ['docs/current/a.md'];
    const digest = 'a'.repeat(64);
    const baselineDigest = 'b'.repeat(64);
    const output = EVIDENCE.checkDocObligations({
      obligations: [{ id: 'conflict-check', capability: 'conflict-check', strength: 'MUST', applicability: 'applicable', scope: { paths: scope } }],
      artifacts: { [scope[0]]: { digest } }, baseline: { digest: baselineDigest, artifacts: {} }, executionRecords: [],
      reviewRecords: [{ id: 'waiver-1', obligationId: 'conflict-check', kind: 'waiver', reason: 'assessment was complete',
        citedRecordIds: ['missing-assessment'], paths: scope, artifactDigests: { [scope[0]]: digest }, baseDigest: baselineDigest }],
    });
    const result = output.results.find(item => item.obligationId === 'conflict-check');
    assert.ok(result);
    assert.notEqual(result.outcome, 'pass');
    assert.ok(output.diagnostics.some(item => item.code === 'unsupported-waiver'));
  });
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nPR-A conflict-check summary: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
