#!/usr/bin/env node
'use strict';

// Deterministic mechanism evidence: these checks use synthetic host envelopes,
// not a live Claude capture. The packet's throwaway-clone witness covers pilot.assess.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(process.env.E1_TEST_ROOT || path.join(__dirname, '..'));
const CHECK = path.join(ROOT, 'harness-everything/scripts/doc-check.js');
const LIFECYCLE = path.join(ROOT, 'harness-everything/scripts/doc-lifecycle.js');
const CONFIG = '.agents/harness-everything/project-docs.json';
const SOURCE = 'docs/adr/EVID-001-verify-all-evidence.md';
const VIEW = 'docs/governed-index.md';
const GENERATOR = 'node harness-everything/scripts/doc-lifecycle.js index --workspace . --config ' + CONFIG + ' --all';
const roots = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const provider = () => require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-provider.js'));
const producer = () => require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-producer.js'));
const events = () => require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-events.js'));
const core = () => require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-core.js'));
const pilot = () => require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-pilot.js'));

function write(root, relative, bytes) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function fixture(generator = GENERATOR) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e1-derived-regenerate-')));
  roots.push(root);
  const config = {
    governed: [{ path: 'docs/adr/*.md', role: 'adr' }],
    domains: ['EVID'],
    derived: [{ path: VIEW, generator }],
  };
  write(root, CONFIG, JSON.stringify(config, null, 2) + '\n');
  write(root, SOURCE, '---\nid: EVID-001\nrole: adr\nstatus: proposed\n---\n\n# EVID-001\n\n## Decision\n\nRetain evidence identities for generated views.\n');
  fs.mkdirSync(path.join(root, 'harness-everything/scripts'), { recursive: true });
  fs.copyFileSync(LIFECYCLE, path.join(root, 'harness-everything/scripts/doc-lifecycle.js'));
  fs.copyFileSync(path.join(ROOT, 'harness-everything/scripts/project-docs-resolver.js'), path.join(root, 'harness-everything/scripts/project-docs-resolver.js'));
  const generated = spawnSync(process.execPath, [path.join(root, 'harness-everything/scripts/doc-lifecycle.js'), 'index', '--workspace', root, '--config', CONFIG, '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  write(root, VIEW, generated.stdout);
  return root;
}

function runCheck(root, withView = true) {
  const args = [CHECK, 'check', '--workspace', root, '--config', CONFIG, '--changed-path', SOURCE];
  if (withView) args.push('--derived-view', VIEW);
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
}

function getReport(result) {
  assert.ok(result.stdout, result.stderr);
  return JSON.parse(result.stdout);
}

function capture(root, result) {
  const command = 'node ' + CHECK + ' check --workspace ' + root + ' --config ' + CONFIG
    + ' --changed-path ' + SOURCE + ' --derived-view ' + VIEW;
  const record = provider().buildCaptureRecord({
    cwd: root, session_id: 'synthetic-author', tool_name: 'Bash', tool_use_id: 'derived-check',
    tool_input: { command }, tool_response: { stdout: result.stdout, interrupted: false },
  }, 'PostToolUse', root);
  record.observedIdentity = { workflowId: 'e1-test', workflowRevision: 1,
    baselinePin: { commit: 'd'.repeat(40), root } };
  return record;
}

function resolveDerived(root, record) {
  const providerModule = provider();
  const identity = {
    workspaceId: 'ws-e1-test', sessionId: record.session_id, workflowId: 'e1-test', workflowRevision: 1,
    taskId: 'task-e1-test', taskScopeDigest: '1'.repeat(64), baselineDigest: '2'.repeat(64),
    candidateDigest: '3'.repeat(64), configDigest: '4'.repeat(64), prdRoot: 'docs/prd/',
  };
  const origin = providerModule.createClaudeOriginProvider({
    hostId: 'claude-code', sessionId: record.session_id, workspaceRoot: root,
    workflowId: identity.workflowId, workflowRevision: identity.workflowRevision, taskId: identity.taskId,
    principals: { author: record.session_id, executors: [record.session_id] },
    baseline: { commit: 'd'.repeat(40), root }, captures: [record],
    qualification: { source: 'fake-test-fixture', faked: true, ref: 'e1-test', toolUseIdPopulated: true, agentIdPopulated: true },
  });
  return origin.resolveEvent({ reference: record.ref + '#derived-regenerate', identity });
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'temporary Git fixture setup must succeed');
  return result.stdout.trim();
}

function generateIndex(root) {
  const result = spawnSync(process.execPath, [path.join(root, 'harness-everything/scripts/doc-lifecycle.js'),
    'index', '--workspace', root, '--config', CONFIG, '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, 'real lifecycle index generation must succeed');
  write(root, VIEW, result.stdout);
}

function wholeSeamFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e1-derived-whole-seam-')));
  roots.push(root);
  const config = {
    governed: [{ path: 'docs/adr/*.md', role: 'adr' }],
    domains: ['EVID'],
    derived: [{ path: VIEW, generator: GENERATOR }],
  };
  const source = (status, text) => `---\nid: EVID-001\nrole: adr\nstatus: ${status}\n---\n\n# EVID-001\n\n## Decision\n\n${text}\n`;
  write(root, CONFIG, JSON.stringify(config, null, 2) + '\n');
  write(root, SOURCE, source('proposed', 'Baseline evidence identity.'));
  fs.mkdirSync(path.join(root, 'harness-everything/scripts'), { recursive: true });
  fs.copyFileSync(LIFECYCLE, path.join(root, 'harness-everything/scripts/doc-lifecycle.js'));
  fs.copyFileSync(path.join(ROOT, 'harness-everything/scripts/project-docs-resolver.js'), path.join(root, 'harness-everything/scripts/project-docs-resolver.js'));
  generateIndex(root);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=e1-fixture', '-c', 'user.email=e1-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
  const baselineCommit = git(root, ['rev-parse', 'HEAD']);
  const baselineTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  write(root, SOURCE, source('accepted', 'Candidate evidence identity.'));
  generateIndex(root);
  return { root, baselineCommit, baselineTree };
}

function wholeSeam() {
  const project = wholeSeamFixture();
  const plain = runCheck(project.root, false);
  assert.equal(plain.status, 0, 'plain-check positive control must pass on the Git fixture');
  getReport(plain);

  const checked = runCheck(project.root);
  assert.equal(checked.status, 0, 'registered --derived-view check must produce a successful report');
  const report = getReport(checked);
  const projection = report.capabilities['derived-regenerate'];
  assert.equal(projection.state, 'pass');
  assert.deepEqual(projection.checkedPaths, [VIEW]);

  const providerModule = provider();
  const sessionId = 'synthetic-author';
  const workflowId = 'e1-whole-seam';
  const workflowRevision = 1;
  const taskId = 'task-req-e1-derived';
  const requirements = [{ id: 'req-e1-derived', summary: 'Regenerate the governed view', acceptance: 'the derived view matches the current source' }];
  const qualification = { source: 'fake-test-fixture', faked: true, ref: 'e1-whole-seam',
    toolUseIdPopulated: true, agentIdPopulated: true };
  const command = 'node ' + CHECK + ' check --workspace ' + project.root + ' --config ' + CONFIG
    + ' --changed-path ' + SOURCE + ' --derived-view ' + VIEW;
  const record = providerModule.buildCaptureRecord({
    cwd: project.root, session_id: sessionId, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'synthetic-derived-check',
    tool_input: { command }, tool_response: { stdout: checked.stdout, interrupted: false },
  }, 'PostToolUse', project.root);
  assert.ok(record, 'synthetic host envelope must yield a captured check record');
  record.observedIdentity = { workflowId, workflowRevision,
    baselinePin: { commit: project.baselineCommit, root: project.root } };

  const origin = providerModule.createClaudeOriginProvider({
    hostId: 'claude-code', sessionId, workspaceRoot: project.root, workflowId, workflowRevision, taskId,
    principals: { author: sessionId, executors: [sessionId] },
    baseline: { commit: project.baselineCommit, root: project.root }, captures: [record], qualification,
  });
  const produced = producer().produceDocSnapshot({
    workspaceRoot: project.root, baseline: { commit: project.baselineCommit, root: project.root },
    workflow: { workflowId, sessionId, workflowRevision }, task: { taskId, requirements },
    scope: { prdRoot: 'docs/prd/' }, activeHost: 'claude-code', prdRoot: 'docs/prd/',
  }, { originProvider: origin });
  assert.equal(produced.state, 'ready', 'production snapshot collector must produce a current snapshot');
  const snapshot = produced.snapshot;
  const obligation = snapshot.obligations.find(item => item.capability === 'derived-regenerate');
  assert.ok(obligation, 'derived-regenerate must derive from the real baseline and candidate bytes');
  assert.equal(obligation.id, 'doc-change:derived-regenerate');
  assert.equal(obligation.strength, 'MUST');
  assert.equal(obligation.applicability, 'applicable', 'derived-regenerate must not disappear as N/A');
  assert.deepEqual(obligation.scope, { paths: [VIEW] });

  const reference = record.ref + '#derived-regenerate';
  const accepted = events().acceptDocEvents({ snapshot, eventRefs: [reference] }, { originProvider: origin });
  assert.equal(accepted.state, 'ready', 'production adapter must accept the derived check reference');
  const acceptedRecord = accepted.acceptedIndex[reference];
  assert.ok(acceptedRecord, 'exact derived check reference must reach the adapter');
  assert.equal(acceptedRecord.obligationId, obligation.id);
  assert.deepEqual(acceptedRecord.paths, obligation.scope.paths);
  assert.deepEqual(acceptedRecord.identity, snapshot.identity, 'accepted reference must bind the current snapshot identity');
  assert.deepEqual(acceptedRecord.event.startIdentity, snapshot.identity);
  assert.deepEqual(acceptedRecord.event.endIdentity, snapshot.identity);
  assert.equal(acceptedRecord.event.derivedBinding.candidateDigest, snapshot.identity.candidateDigest);

  const checkedEvidence = core().checkAcceptedDocEvidence({ snapshot, accepted, mode: 'verification' });
  const derivedResult = checkedEvidence.results.find(item => item.obligationId === obligation.id);
  assert.ok(checkedEvidence.checkedMustIds.includes(obligation.id), 'the exact derived MUST must reach reconciliation');
  assert.equal(derivedResult.observation, 'observed');
  assert.equal(derivedResult.outcome, 'pass');
  assert.ok(derivedResult.recordRefs.includes(reference));
  assert.ok(!checkedEvidence.unsatisfied.some(item => item.obligationId === obligation.id));

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-derived-session-'));
  roots.push(sessionDir);
  providerModule.writeImmutableEvent(sessionDir, record);
  providerModule.rebuildJournalView(sessionDir);
  const context = { root: project.root, sessionId, sessionDir, activeHost: 'claude-code', workflow: {
    workflowId, revision: workflowRevision, strategy: 'iterative-single', state: 'running',
    docReconciliationBaseline: { root: project.root, commit: project.baselineCommit, tree: project.baselineTree },
  } };
  const set = { strategy: 'iterative-single', stepBindingsEnabled: true, requirements };
  const previousSwitch = process.env.HARNESS_DOC_RECONCILIATION_PILOT;
  const originalFactory = providerModule.createClaudeOriginProvider;
  providerModule.createClaudeOriginProvider = input => originalFactory({ ...input, qualification });
  process.env.HARNESS_DOC_RECONCILIATION_PILOT = '1';
  try {
    const pilotResult = pilot().assess(context, set);
    assert.ok(pilotResult.report.expectedMustIds.includes(obligation.id), 'pilot must retain the exact derived MUST in its expected set');
    assert.ok(!pilotResult.report.unsatisfied.some(item => item.obligationId === obligation.id),
      'pilot consumer must observe the passing derived MUST');

    fs.appendFileSync(path.join(project.root, VIEW), '\nmanual stale edit\n');
    const stalePilot = pilot().assess(context, set);
    assert.ok(stalePilot.report.expectedMustIds.includes(obligation.id), 'stale view must remain an expected derived MUST');
    assert.ok(stalePilot.report.unsatisfied.some(item => item.obligationId === obligation.id),
      'consumer-level stale target negative must withhold the derived MUST');
  } finally {
    providerModule.createClaudeOriginProvider = originalFactory;
    if (previousSwitch === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
    else process.env.HARNESS_DOC_RECONCILIATION_PILOT = previousSwitch;
  }
}

try {
  if (process.env.E1_BASELINE_RED === '1') {
    const project = wholeSeamFixture();
    const plain = runCheck(project.root, false);
    assert.equal(plain.status, 0, 'pre-repair fixture plain-check positive control must pass');
    getReport(plain);
    const derived = runCheck(project.root);
    const legacyReport = JSON.parse(derived.stdout);
    assert.match(legacyReport.lint?.error || '', /unknown or incomplete argument: --derived-view/,
      'pre-repair compatibility control must identify the unsupported derived-view flag');
    assert.equal(derived.status, 0,
      `pre-repair primary RED: registered --derived-view check must reach the passing derived obligation; legacy parser rejected the flag (child exit ${derived.status})`);
    const projection = getReport(derived).capabilities['derived-regenerate'];
    assert.equal(projection?.state, 'pass', 'pre-repair primary RED: derived result must reach the passing obligation assertion');
  } else {
    const providerModule = provider();
    const invocationCommand = 'node ' + CHECK + ' check --workspace ' + ROOT + ' --config ' + CONFIG
      + ' --changed-path docs/doc-workflow-reconciliation.md --derived-view ' + VIEW;
    const invocation = providerModule.resolveDocCheckInvocation(invocationCommand, ROOT);
    assert.equal(invocation.kind, 'accepted', 'registered derived invocation rejected: ' + invocation.reason);
    assert.equal(invocation.derivedView, VIEW);

  const matching = fixture();
  const matchingBytes = fs.readFileSync(path.join(matching, VIEW));
  const matchingRun = runCheck(matching);
  assert.equal(matchingRun.status, 0, matchingRun.stderr);
  const matchingReport = getReport(matchingRun);
  const positive = matchingReport.capabilities['derived-regenerate'];
  assert.equal(positive.state, 'pass');
  assert.deepEqual(positive.checkedPaths, [VIEW]);
  assert.equal(positive.binding.generation.state, 'pass');
  assert.equal(positive.binding.comparison.state, 'equal');
  assert.equal(positive.binding.generation.outputDigest, sha(matchingBytes));
  assert.equal(positive.binding.comparison.targetDigest, sha(matchingBytes));
  assert.equal(positive.binding.sourceCorpus.complete, true);
  assert.deepEqual(positive.binding.sourceCorpus.paths, [SOURCE]);
  assert.equal(positive.binding.config.digest, sha(fs.readFileSync(path.join(matching, CONFIG))));
  assert.equal(matchingReport.coverage.unsupported.some(item => item.path === VIEW), false);
  const captured = capture(matching, matchingRun);
  assert.equal(captured.implementationDigest, providerModule.SHIPPED_DOC_CHECK_DIGEST);
  assert.equal(captured.observedDerivedDigests[SOURCE], positive.binding.sourceCorpus.digests[SOURCE]);
  assert.equal(captured.observedDerivedDigests[VIEW], positive.binding.comparison.targetDigest);
  assert.deepEqual(captured.observedDerivedConfigSources, positive.binding.config.sources);
  const positiveResolution = resolveDerived(matching, captured);
  assert.equal(positiveResolution.status, 'accepted', JSON.stringify(positiveResolution.diagnostics));

  const stale = fixture();
  const staleTarget = path.join(stale, VIEW);
  fs.appendFileSync(staleTarget, '\nmanual stale edit\n');
  const staleBefore = fs.readFileSync(staleTarget);
  const staleRun = runCheck(stale);
  assert.equal(staleRun.status, 0, staleRun.stderr);
  const staleProjection = getReport(staleRun).capabilities['derived-regenerate'];
  assert.equal(staleProjection.state, 'stale');
  assert.equal(staleProjection.binding.generation.state, 'pass');
  assert.equal(staleProjection.binding.comparison.state, 'stale');
  assert.deepEqual(fs.readFileSync(staleTarget), staleBefore, 'stale target must not be rewritten');

  const unsupportedMarker = 'GENERATOR_MUST_NOT_RUN';
  const unsupportedGenerator = 'node -e ' + JSON.stringify('require("fs").writeFileSync("' + unsupportedMarker + '","ran")');
  const unsupported = fixture(unsupportedGenerator);
  const unsupportedRun = runCheck(unsupported);
  const unsupportedProjection = getReport(unsupportedRun).capabilities['derived-regenerate'];
  assert.equal(unsupportedProjection.state, 'unsupported');
  assert.equal(fs.existsSync(path.join(unsupported, unsupportedMarker)), false, 'configured text must never be executed');

  const changedAfterCheck = fixture();
  const changedRun = runCheck(changedAfterCheck);
  const changedBinding = getReport(changedRun).capabilities['derived-regenerate'].binding;
  fs.appendFileSync(path.join(changedAfterCheck, SOURCE), '\nchanged after check\n');
  const changedCapture = capture(changedAfterCheck, changedRun);
  assert.notEqual(changedCapture.observedDerivedDigests[SOURCE], changedBinding.sourceCorpus.digests[SOURCE]);
  const changedResponse = resolveDerived(changedAfterCheck, changedCapture);
  assert.equal(changedResponse.status, 'rejected');
  assert.ok(changedResponse.diagnostics.some(item => item.code === 'derived-input-changed-after-check'));

  const configChanged = fixture();
  const configRun = runCheck(configChanged);
  fs.appendFileSync(path.join(configChanged, CONFIG), '\n');
  const configCapture = capture(configChanged, configRun);
  const configResponse = resolveDerived(configChanged, configCapture);
  assert.equal(configResponse.status, 'rejected');
  assert.ok(configResponse.diagnostics.some(item => item.code === 'derived-input-changed-after-check'));

  const targetChanged = fixture();
  const targetRun = runCheck(targetChanged);
  fs.appendFileSync(path.join(targetChanged, VIEW), '\nchanged after check\n');
  const targetCapture = capture(targetChanged, targetRun);
  const targetResponse = resolveDerived(targetChanged, targetCapture);
  assert.equal(targetResponse.status, 'rejected');
  assert.ok(targetResponse.diagnostics.some(item => item.code === 'derived-input-changed-after-check'));

  const plain = runCheck(matching, false);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(getReport(plain).capabilities['derived-regenerate'], undefined);

  wholeSeam();
  console.log('PASS E1 registered invocation, producer-to-pilot derived MUST seam, consumer stale negative, bound generation, provider negatives, and plain-check firebreak (deterministic mechanism evidence)');
  }
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
