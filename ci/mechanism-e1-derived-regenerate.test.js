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
const PROVIDER = require('../hooks/scripts/lib/doc-reconciliation-provider');

const ROOT = path.resolve(__dirname, '..');
const CHECK = path.join(ROOT, 'harness-everything/scripts/doc-check.js');
const LIFECYCLE = path.join(ROOT, 'harness-everything/scripts/doc-lifecycle.js');
const CONFIG = '.agents/harness-everything/project-docs.json';
const SOURCE = 'docs/adr/EVID-001-verify-all-evidence.md';
const VIEW = 'docs/governed-index.md';
const GENERATOR = 'node harness-everything/scripts/doc-lifecycle.js index --workspace . --config ' + CONFIG + ' --all';
const roots = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

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
  const record = PROVIDER.buildCaptureRecord({
    cwd: root, session_id: 'synthetic-author', tool_name: 'Bash', tool_use_id: 'derived-check',
    tool_input: { command }, tool_response: { stdout: result.stdout, interrupted: false },
  }, 'PostToolUse', root);
  record.observedIdentity = { workflowId: 'e1-test', workflowRevision: 1,
    baselinePin: { commit: 'd'.repeat(40), root } };
  return record;
}

function resolveDerived(root, record) {
  const identity = {
    workspaceId: 'ws-e1-test', sessionId: record.session_id, workflowId: 'e1-test', workflowRevision: 1,
    taskId: 'task-e1-test', taskScopeDigest: '1'.repeat(64), baselineDigest: '2'.repeat(64),
    candidateDigest: '3'.repeat(64), configDigest: '4'.repeat(64), prdRoot: 'docs/prd/',
  };
  const origin = PROVIDER.createClaudeOriginProvider({
    hostId: 'claude-code', sessionId: record.session_id, workspaceRoot: root,
    workflowId: identity.workflowId, workflowRevision: identity.workflowRevision, taskId: identity.taskId,
    principals: { author: record.session_id, executors: [record.session_id] },
    baseline: { commit: 'd'.repeat(40), root }, captures: [record],
    qualification: { source: 'fake-test-fixture', faked: true, ref: 'e1-test', toolUseIdPopulated: true, agentIdPopulated: true },
  });
  return origin.resolveEvent({ reference: record.ref + '#derived-regenerate', identity });
}

try {
  const invocationCommand = 'node ' + CHECK + ' check --workspace ' + ROOT + ' --config ' + CONFIG
    + ' --changed-path docs/doc-workflow-reconciliation.md --derived-view ' + VIEW;
  const invocation = PROVIDER.resolveDocCheckInvocation(invocationCommand, ROOT);
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
  assert.equal(captured.implementationDigest, PROVIDER.SHIPPED_DOC_CHECK_DIGEST);
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

  console.log('PASS E1 registered invocation, bound generation, stale preservation, unsupported generator, source/config/target change rejection, and plain-check firebreak');
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
