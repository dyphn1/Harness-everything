#!/usr/bin/env node
'use strict';

// R2c-1 (#325 3b S2b): origin provider (R2C1 rows retained for R2 retirement).
//
// Binding spec at the time of writing: docs/doc-workflow-reconciliation.md
// § S2b — "Activation and pilot-only scope", "Claude capture and
// origin-provider contract", "Retained live-capture gate"; owner decisions in
// dyphn1/Harness-everything#325 (issuecomment-6312323110), rows 1 and 2.
//
// Contract of this suite:
// - Every assertion runs on both legs (canonical hooks/scripts and the
//   packaged plugins/harness-everything copy). Missing S2b modules or exports
//   are FAIL with a module-missing/export-missing reason; the harness never
//   crashes; INFRA is reserved for fixture/subprocess faults.
// - Items 3–6 bind the retained S2b origin provider through the S2a
//   resolveContext/resolveEvent seam contract. These R2C1 rows stay here until
//   R2 retires the provider module.
// - The surviving P2b state-persist controls moved to
//   mechanism-553-state-persist-post-tool-use.test.js.
// - Exit codes: 1 if any assertion failed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./fixtures/doc-obligations/reconciliation-s2b/capture/harness');
const { DISTRIBUTIONS } = require('./lib/doc-reconciliation-prep-fixtures');

const PILOT_SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const PROVIDER_REQ = [{ file: 'doc-reconciliation-provider.js', exports: ['createClaudeOriginProvider'] }];

const runner = H.createRunner('R2c-1 S2b capture/provider');

// ---- Items 3–6: the S2b origin provider --------------------------------------

function makeProvider(leg, input) {
  const met = H.requirementsMet(leg, PROVIDER_REQ);
  if (met.error) throw new Error(met.error);
  const provider = met.mods['doc-reconciliation-provider.js'].createClaudeOriginProvider(H.providerInput(input));
  if (!provider || typeof provider.resolveEvent !== 'function' || typeof provider.resolveContext !== 'function') {
    throw new Error('createClaudeOriginProvider must return { resolveContext, resolveEvent } implementing the S2a seam');
  }
  return provider;
}

function runProvider(leg, input, reference) {
  const provider = makeProvider(leg, input);
  const response = provider.resolveEvent({ reference, identity: H.providerIdentity() });
  const out = { response, provider, context: provider.resolveContext({ workspaceRoot: H.FIXED.workspaceRoot, workflowId: H.FIXED.workflowId, sessionId: H.FIXED.sessionId }) };
  return out;
}

// No-qualification cases run from an isolated copy of the provider, with no live-capture directory above it. The gate
// outcome then never depends on whether retained live evidence exists in this checkout, so the live capture can land
// without turning these gate-unmet cases into INFRA.
function isolatedRunProvider(leg, input, reference) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c1-isolated-'));
  try {
    const lib = path.join(dir, 'hooks', 'scripts', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.copyFileSync(path.join(leg.lib, 'doc-reconciliation-provider.js'), path.join(lib, 'doc-reconciliation-provider.js'));
    fs.copyFileSync(path.join(leg.lib, 'workflow-isolation.js'), path.join(lib, 'workflow-isolation.js'));
    const sharedScriptsLib = path.join(dir, 'scripts', 'lib');
    fs.mkdirSync(sharedScriptsLib, { recursive: true });
    fs.copyFileSync(path.resolve(leg.lib, '../../../scripts/lib/verification-contract.js'),
      path.join(sharedScriptsLib, 'verification-contract.js'));
    const provider = require(path.join(lib, 'doc-reconciliation-provider.js')).createClaudeOriginProvider(H.providerInput(input));
    const response = provider.resolveEvent({ reference, identity: H.providerIdentity() });
    const context = provider.resolveContext({ workspaceRoot: H.FIXED.workspaceRoot, workflowId: H.FIXED.workflowId, sessionId: H.FIXED.sessionId });
    return { response, provider, context };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertNoExitZeroCredit(out, label) {
  const { response } = out;
  if (response && response.status === 'accepted') {
    if (Number.isInteger(response.event && response.event.exitCode) && response.event.exitCode === 0) {
      throw new Error(`${label}: accepted and mapped exit 0`);
    }
    throw new Error(`${label}: unexpected accepted response ${JSON.stringify(response).slice(0, 200)}`);
  }
  if (!(response && Array.isArray(response.diagnostics) && response.diagnostics.length)) throw new Error(`${label}: ${response && response.status} with no diagnostics`);
}

function captureDiagnosticsText(out) {
  return JSON.stringify([...((out.response && out.response.diagnostics) || []), ...((out.context && out.context.diagnostics) || [])]);
}

runner.run('R2C1-EXIT-MAPPING-SUCCESS', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (!out.response || out.response.status !== 'accepted') {
    throw new Error(`success event not accepted: ${out.response ? out.response.status : 'no response'} ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
  const event = out.response.event;
  if (!Number.isInteger(event.exitCode) || event.exitCode !== 0) throw new Error(`owner decision 1: expected integer exit 0, got ${event.exitCode}`);
  if (event.signal !== null) throw new Error(`owner decision 1: expected signal null, got ${event.signal}`);
  if (event.toolCorrelationId !== 'toolu_r2c1_a') throw new Error(`toolCorrelationId mismatch: ${event.toolCorrelationId}`);
  if (event.command !== H.payload('payload-post-tool-use-success.json').tool_input.command) throw new Error(`event command mismatch: ${event.command}`);
  const originRef = out.response.originRef !== undefined ? out.response.originRef : out.context && out.context.originRef;
  if (typeof originRef !== 'string') throw new Error(`accepted event missing originRef binding`);
});

runner.run('R2C1-EXIT-MAPPING-FAILURE-SAME-ID', PROVIDER_REQ, (_mods, leg) => {
  const captures = [
    H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass', toolUseId: 'toolu_r2c1_b' }),
    H.simulateCapture('payload-post-tool-use-failure.json', { ref: 'exec-fail', toolUseId: 'toolu_r2c1_b' }),
  ];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  assertNoExitZeroCredit(out, 'failure for the same tool_use_id must void the success mapping');
});

runner.run('R2C1-EXIT-MAPPING-FAILURE-NEVER-CREDITED', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-failure.json', { ref: 'exec-fail' })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-fail');
  assertNoExitZeroCredit(out, 'PostToolUseFailure is never credited');
});

runner.run('R2C1-EXIT-MAPPING-INTERRUPTED', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass', interrupted: true })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  assertNoExitZeroCredit(out, 'interrupted success must not be mapped to exit 0');
});

runner.run('R2C1-EXIT-MAPPING-MISSING-TOOL-USE-ID', PROVIDER_REQ, (_mods, leg) => {
  const record = H.simulateCapture('payload-post-tool-use-success-minimal.json', { ref: 'exec-pass' });
  delete record.tool_use_id;
  const out = runProvider(leg, { captures: [record], qualification: H.fakeQualification('sim') }, 'exec-pass');
  assertNoExitZeroCredit(out, 'missing tool_use_id must not be credited');
});

// ---- Item 4: reviewer independence via host-issued subagent principal ---------

const REVIEW_REF = 'review-1';
const REVIEW_TEAM_REF = 'review-task-result';

function reviewCaptures(agentIdStop, agentIdTask, opts = {}) {
  return [
    H.simulateCapture('payload-subagent-stop.json', { ref: REVIEW_REF, agentId: agentIdStop }),
    H.simulateCapture('payload-task-result.json', { ref: REVIEW_TEAM_REF, agentId: agentIdTask }),
  ];
}

runner.run('R2C1-REVIEWER-VALID', PROVIDER_REQ, (_mods, leg) => {
  const out = runProvider(leg, { captures: reviewCaptures('agent-r2c1-rev', 'agent-r2c1-rev'), qualification: H.fakeQualification('sim') }, REVIEW_REF);
  if (!out.response || out.response.status !== 'accepted') {
    throw new Error(`independent reviewer event not accepted: ${out.response ? out.response.status : 'no response'} ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
  const event = out.response.event;
  if (event.kind !== 'review') throw new Error(`expected a review event, got kind ${event.kind}`);
  if (event.principalId !== 'agent-r2c1-rev') throw new Error(`reviewer principal must be the host agent_id, got ${event.principalId}`);
  const independentOf = Array.isArray(event.independentOf) ? event.independentOf.map(String) : [];
  for (const required of [H.FIXED.sessionId]) {
    if (!independentOf.includes(required)) throw new Error(`independentOf must include author ${required}: ${JSON.stringify(independentOf)}`);
  }
  if (independentOf.includes('agent-r2c1-rev')) throw new Error(`independentOf must not include the reviewer himself`);
  const blob = JSON.stringify(event);
  const stopRecord = H.simulateCapture('payload-subagent-stop.json', { ref: 'unused' });
  if (!blob.includes(stopRecord.reviewDigest)) throw new Error(`review event lost the bound final review artifact digest ${stopRecord.reviewDigest}`);
});

runner.run('R2C1-REVIEWER-SAME-ID-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  // agent_id identical to the author session id: not independent.
  const out = runProvider(leg, { captures: reviewCaptures(H.FIXED.sessionId, H.FIXED.sessionId), qualification: H.fakeQualification('sim') }, REVIEW_REF);
  assertNoExitZeroCredit(out, 'reviewer equal to author must be rejected');
});

runner.run('R2C1-REVIEWER-EXECUTOR-ID-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  const out = runProvider(leg, {
    captures: reviewCaptures('agent-exec-1', 'agent-exec-1'),
    executorPrincipals: ['agent-exec-1'],
    qualification: H.fakeQualification('sim'),
  }, REVIEW_REF);
  assertNoExitZeroCredit(out, 'reviewer equal to an executor must be rejected');
});

runner.run('R2C1-REVIEWER-SURFACE-INCONSISTENCY-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  // SubagentStop and the Task result name different subagent identities:
  // the surfaces must be consistent or the record is rejected (doc capture table).
  const out = runProvider(leg, { captures: reviewCaptures('agent-r2c1-rev', 'agent-someone-else'), qualification: H.fakeQualification('sim') }, REVIEW_REF);
  assertNoExitZeroCredit(out, 'identity inconsistency between SubagentStop and the Task result must be rejected');
});

runner.run('R2C1-REVIEWER-REPLAY-COPIED-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  // Same host event content re-presented under a new reference/captureId:
  // the fresh first resolution stays accepted, the copied second is rejected.
  const first = H.simulateCapture('payload-subagent-stop.json', { ref: REVIEW_REF });
  const replay = H.simulateCapture('payload-subagent-stop.json', { ref: 'review-replay' });
  replay.reviewDigest = first.reviewDigest;
  // F4-T5 conflict 3: the review needs its correlated Agent/Task result surface, delivered with the original.
  const task = H.simulateCapture('payload-task-result.json', { ref: REVIEW_TEAM_REF, agentId: 'agent-r2c1-rev' });
  const provider = makeProvider(leg, { captures: [first, task, replay], qualification: H.fakeQualification('sim') });
  const firstResponse = provider.resolveEvent({ reference: REVIEW_REF, identity: H.providerIdentity() });
  if (!firstResponse || firstResponse.status !== 'accepted') {
    throw new Error(`copy test needs the original to be accepted first; got ${(firstResponse && firstResponse.status) || 'none'} ${JSON.stringify((firstResponse && firstResponse.diagnostics) || []).slice(0, 200)}`);
  }
  const replayResponse = provider.resolveEvent({ reference: 'review-replay', identity: H.providerIdentity() });
  if (replayResponse && replayResponse.status === 'accepted') {
    throw new Error('copied/replayed record was accepted under a new reference');
  }
});

// F4-T5 conflict 1: a reviewer that ran a registered doc-check is an executor, so its review is refused. Its plain tool
// use is not execution evidence, so the same review stays accepted (the control keeps the refusal from being vacuous).
runner.run('R2C1-REVIEWER-RAN-EVIDENCE-REFUSED', PROVIDER_REQ, (_mods, leg) => {
  const plain = H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-plain', agentId: 'agent-r2c1-rev' });
  const control = runProvider(leg, { captures: [plain, ...reviewCaptures('agent-r2c1-rev', 'agent-r2c1-rev')], qualification: H.fakeQualification('sim') }, REVIEW_REF);
  if (!control.response || control.response.status !== 'accepted') {
    throw new Error(`control: a reviewer's plain tool use must not refuse the review; got ${control.response ? control.response.status : 'no response'}`);
  }
  const run = H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass', agentId: 'agent-r2c1-rev' });
  run.command = `node ${DISTRIBUTIONS[leg.name].docCheck} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md`;
  const out = runProvider(leg, { captures: [run, ...reviewCaptures('agent-r2c1-rev', 'agent-r2c1-rev')], qualification: H.fakeQualification('sim') }, REVIEW_REF);
  if (!out.response || out.response.status === 'accepted') throw new Error('reviewer that ran the registered check was accepted as independent');
  if (!captureDiagnosticsText(out).includes('reviewer-not-independent')) throw new Error(`refused for another reason: ${captureDiagnosticsText(out).slice(0, 200)}`);
});

// A labelled `Review verdict: reject` never approves, and neither does free text that only says REJECT. Both are
// fixtures on the independent reviewer surface, so only the verdict line decides the outcome.
for (const [id, fixture] of [
  ['R2C1-REVIEWER-REJECT-NEVER-APPROVES', 'payload-subagent-stop-reject.json'],
  ['R2C1-REVIEWER-FREETEXT-REJECT-NEVER-APPROVES', 'payload-subagent-stop-freetext-reject.json'],
]) {
  runner.run(id, PROVIDER_REQ, (_mods, leg) => {
    const captures = [H.simulateCapture(fixture, { ref: REVIEW_REF, agentId: 'agent-r2c1-rev' }), H.simulateCapture('payload-task-result.json', { ref: REVIEW_TEAM_REF, agentId: 'agent-r2c1-rev' })];
    const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, REVIEW_REF);
    assertNoExitZeroCredit(out, `${fixture} must never approve`);
  });
}

// ---- Item 5: unsupported hosts are unavailable and never borrow Claude mapping

runner.run('R2C1-UNSUPPORTED-OPENCODE', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = runProvider(leg, { hostId: 'opencode', captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (out.response && out.response.status === 'accepted') throw new Error('opencode must not be accepted');
  if (out.context && out.context.status === 'accepted') throw new Error('opencode resolveContext must be unavailable');
  if (!(out.response && out.response.status === 'unavailable' && out.context && out.context.status === 'unavailable')) {
    throw new Error(`expected provider unavailable, got response=${out.response && out.response.status} context=${out.context && out.context.status}`);
  }
  if (JSON.stringify(captureDiagnosticsText(out)).length < 4) throw new Error('unavailable response carried no diagnostics');
});

runner.run('R2C1-UNSUPPORTED-CODEX', PROVIDER_REQ, (_mods, leg) => {
  // Codex-shaped capture including a numeric exit on the record: the provider
  // must stay unavailable and must not credit that numeric exit via any path.
  const capture = H.simulateCapture('payload-post-tool-use-failure.json', { ref: 'exec-pass' });
  capture.capturedExitCode = 2;
  const out = runProvider(leg, { hostId: 'codex', captures: [capture], qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (out.response && out.response.status !== 'unavailable') throw new Error(`codex expected unavailable, got ${(out.response && out.response.status)}`);
  if (out.context && out.context.status === 'accepted') throw new Error('codex resolveContext must be unavailable');
});

// ---- Item 6: retained live-capture gate disabling positive credit -------------

runner.run('R2C1-LIVE-GATE-UNMET', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = isolatedRunProvider(leg, { captures }, 'exec-pass'); // no qualification, isolated: production retained-evidence path
  if (out.response && out.response.status === 'accepted') throw new Error('positive credit granted while the retained live gate is unmet');
  if (!/live[- ]?gate|qualification/i.test(captureDiagnosticsText(out))) {
    throw new Error(`gate-unmet response must say why: ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
});

runner.run('R2C1-LIVE-GATE-DI-QUALIFICATION-OPENS', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (!out.response || out.response.status !== 'accepted') {
    throw new Error(`every otherwise-valid simulated event must resolve under an explicitly fake DI qualification: ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
});

runner.run('R2C1-LIVE-GATE-NO-ENV-OR-FLAG-BYPASS', PROVIDER_REQ, (_mods, leg) => {
  const capture = H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' });
  capture.trusted = true;
  // The host switch and a self-declared `trusted` capture flag must not open
  // the gate: qualification resolves only from retained live evidence (DI
  // excepted for tests).
  const previous = process.env[PILOT_SWITCH];
  process.env[PILOT_SWITCH] = '1';
  try {
    const out = isolatedRunProvider(leg, { captures: [capture] }, 'exec-pass'); // no DI qualification, isolated
    if (out.response && out.response.status === 'accepted') {
      throw new Error('live gate was bypassed by env toggle/record flag (must stay unmet without retained evidence)');
    }
    if (out.context && out.context.status === 'accepted') {
      throw new Error('live gate was bypassed at resolveContext by env toggle/record flag');
    }
  } finally {
    if (previous === undefined) delete process.env[PILOT_SWITCH];
    else process.env[PILOT_SWITCH] = previous;
  }
});

// Manifest route ownership is covered by mechanism-553-p2a-claude-hooks.test.js;
// the surviving legacy-callback controls live in
// mechanism-553-state-persist-post-tool-use.test.js.

// ---- Summary ------------------------------------------------------------------

function finish(counts) {
  if (counts.FAIL === 0 && counts.INFRA === 0) {
    console.log('R2c-1 suite: all assertions PASS.');
    process.exit(0);
  }
  console.log(`R2c-1 suite: FAIL/INFRA present (failed assertions: ${counts.FAIL}, infra faults: ${counts.INFRA}).`);
  process.exit(1);
}

finish(runner.summary());
