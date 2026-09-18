#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { buildRouterContract } = require(path.join(ROOT, 'harness-everything/scripts/router-contract-core.js'));
const { prepareRun } = require(path.join(ROOT, 'fable-mode/scripts/workflow-plan-consumer.js'));
const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
const { atomicWriteJson } = require(path.join(ROOT, 'hooks/scripts/lib/fable-contracts.js'));
const {
  createLearningOpportunity,
  readJson,
} = require(path.join(ROOT, 'hooks/scripts/lib/learning-opportunity.js'));
const {
  evaluateCandidate,
  listCandidates,
  observeCandidate,
  promoteCandidate,
} = require(path.join(ROOT, 'self-evolve/scripts/lesson-candidate.js'));
const {
  retrieveMemoryRecords,
} = require(path.join(ROOT, 'multi-agent-workspace/scripts/index_memory.js'));

let failed = 0;
function check(condition, message, detail = '') {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}
function run(script, payload, options = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: { ...process.env, ...(options.env || {}) },
  });
}

console.log('=== Self-Evolve Closed Loop (#141 Phase 1-3) ===');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-self-evolve-loop-'));
const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-self-evolve-state-'));
const previousStateHome = process.env.HARNESS_STATE_HOME;
process.env.HARNESS_STATE_HOME = stateHome;

try {
  const gitInit = spawnSync('git', ['init'], { cwd: workspace, encoding: 'utf8' });
  check(gitInit.status === 0, 'fixture initializes a real git workspace', gitInit.stderr);

  // Phase 1a: actual Rule-of-3 tracker event -> lesson candidate.
  const ruleSession = 'loop-rule-session';
  const ruleSessionDir = getSessionDir(workspace, ruleSession, { cwd: workspace, session_id: ruleSession });
  atomicWriteJson(path.join(ruleSessionDir, 'workflow-run.json'), {
    schemaVersion: 2,
    sessionId: ruleSession,
    workflowId: 'wf-rule-recovery',
    state: 'running',
    strategy: 'iterative-single',
    revision: 0,
    workflowPlan: {
      strategy: 'iterative-single',
      memory: { write: 'none' },
      limits: { maxIterations: 8, maxRevisionRounds: 2, maxReplans: 2, maxWorkers: 4 },
    },
  });
  atomicWriteJson(path.join(ruleSessionDir, 'rule-of-3-state.json'), {
    count: 0,
    lastHash: '0123456789abcdef0123456789abcdef',
    category: 'test',
    threshold: 3,
    zoomOutResolved: true,
    zoomOutCycles: 1,
    lastFailureAt: Date.now() - 1000,
  });
  const secretMarker = 'ghp_should_never_enter_learning_candidate_1234567890';
  const ruleTracker = run('hooks/scripts/rule-of-3-tracker.js', {
    session_id: ruleSession,
    cwd: workspace,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_use_id: 'rule-recovery-success',
    tool_input: { command: `echo ${secretMarker}` },
    tool_response: { exitCode: 0, stdout: `success ${secretMarker}`, stderr: '' },
  }, { cwd: workspace, env: { HARNESS_STATE_HOME: stateHome } });
  check(ruleTracker.status === 0, 'Rule-of-3 recovery tracker exits successfully', ruleTracker.stderr);

  const ruleCandidates = listCandidates({ workspace, sessionId: ruleSession });
  check(ruleCandidates.length === 1, 'Rule-of-3 verified recovery automatically creates one lesson candidate');
  const ruleCandidate = ruleCandidates[0];
  check(ruleCandidate.trigger.type === 'rule-of-3-recovery', 'Rule-of-3 candidate records the objective trigger type');
  check(ruleCandidate.state === 'proposed', 'runtime recovery creates proposal only, not durable memory');
  check(!JSON.stringify(ruleCandidate).includes(secretMarker), 'candidate payload excludes raw command/output/secret-like runtime text');
  check(ruleCandidate.trigger.sourceEventIds.length === 2, 'candidate retains minimal source-event provenance');

  const ruleEval = evaluateCandidate({
    workspace,
    sessionId: ruleSession,
    candidateId: ruleCandidate.candidateId,
    rule: 'Always verify the changed test path after a repeated failure recovery',
    scopeTask: 'repeated failure recovery test verification',
    scopeRole: 'coordinator',
  });
  check(ruleEval.candidate.state === 'inconclusive', 'Rule-of-3 linear recovery is not misrepresented as valid counterfactual replay');
  check(ruleEval.candidate.evaluation.replayable === false, 'Rule-of-3 candidate explicitly requires paired/later recurrence evidence');
  check(ruleEval.candidate.evaluation.improvementClaim === false, 'screening/evaluation never claims behavioral improvement');

  // Phase 1b: actual Fable contract-test fail -> pass transition -> candidate.
  const verifierSession = 'loop-verifier-session';
  const workflowId = 'wf-verifier-recovery';
  const runId = 'run-verifier-recovery';
  const routerContract = buildRouterContract({
    routingStatus: 'ok',
    recommendedTier: 'Tier 3 (Major)',
    rationale: 'major staged verification fixture',
    signals: {
      expectedDuration: 'single-session',
      dependencyGraph: 'dependent',
      writeSetOverlap: 'overlap',
    },
  });
  check(routerContract.workflowPlan.strategy === 'fable-staged', 'fixture selects fable-staged for verifier recovery');

  const prepared = prepareRun({
    routerContract,
    stages: [{
      stageId: 'repair',
      goal: 'repair verified regression',
      agent: 'fable-worker',
      task: 'repair',
      inputs: [],
      expectedOutputs: ['repair evidence'],
      outputPath: null,
      dependsOn: [],
      writeSet: ['src'],
      checkCommand: 'node --test recovery.test.js',
      passCondition: 'exit 0',
    }],
    workspaceRoot: workspace,
    runId,
    sessionId: verifierSession,
    workflowId,
  });

  const verifierSessionDir = getSessionDir(workspace, verifierSession, { cwd: workspace, session_id: verifierSession });
  atomicWriteJson(path.join(verifierSessionDir, 'workflow-run.json'), {
    schemaVersion: 2,
    sessionId: verifierSession,
    workflowId,
    runId,
    state: 'running',
    strategy: 'fable-staged',
    tier: 'tier3',
    revision: 0,
    workflowPlan: routerContract.workflowPlan,
  });

  const repairFile = path.join(prepared.runRoot, 'contracts', 'repair.json');
  const failedRepair = readJson(repairFile);
  failedRepair.status = 'fail';
  failedRepair.workerId = 'worker-repair';
  failedRepair.evidence = 'red fixture';
  failedRepair.verifiedAt = new Date(Date.now() - 1000).toISOString();
  failedRepair.updatedAt = failedRepair.verifiedAt;
  atomicWriteJson(repairFile, failedRepair);

  const verifierHook = run('hooks/scripts/contract-test.js', {
    session_id: verifierSession,
    cwd: workspace,
    worker_id: 'worker-repair',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_use_id: 'verifier-pass',
    tool_input: { command: 'node --test recovery.test.js' },
    tool_response: { exitCode: 0, stdout: '1..1\n# pass 1', stderr: '' },
  }, { cwd: workspace, env: { HARNESS_STATE_HOME: stateHome } });
  check(verifierHook.status === 0, 'real contract-test hook accepts the later passing verifier event', verifierHook.stderr);

  const verifierCandidates = listCandidates({ workspace, sessionId: verifierSession });
  check(verifierCandidates.length === 1, 'verifier fail-to-pass transition automatically creates one lesson candidate');
  const verifierCandidate = verifierCandidates[0];
  check(verifierCandidate.trigger.type === 'verifier-fail-pass', 'verifier candidate records fail-to-pass trigger');
  check(verifierCandidate.evidence.previousStatus === 'fail' && verifierCandidate.evidence.currentStatus === 'pass', 'candidate retains objective verifier transition');
  check(!JSON.stringify(verifierCandidate).includes('1..1'), 'verifier candidate does not persist raw verifier output');

  const verifierEval = evaluateCandidate({
    workspace,
    sessionId: verifierSession,
    candidateId: verifierCandidate.candidateId,
    rule: 'Always rerun recovery.test.js after changing the repair path',
    scopeTask: 'repair path recovery test',
    scopeRequirement: 'REQ-141',
    scopeRole: 'coordinator',
  });
  check(verifierEval.candidate.state === 'accepted', 'objective verifier fail-to-pass candidate can become accepted for governed promotion');
  check(verifierEval.candidate.evaluation.replayable === true, 'objective verifier transition is deterministically replayable as evidence');
  check(verifierEval.candidate.evaluation.improvementClaim === false, 'accepted candidate remains distinct from an effectiveness claim');

  // Phase 3 boundary: accepted is still not durable until #134 authorization exists.
  const noAuth = (() => {
    try {
      promoteCandidate({
        workspace,
        sessionId: verifierSession,
        candidateId: verifierCandidate.candidateId,
      });
      return null;
    } catch (error) { return error; }
  })();
  check(Boolean(noAuth) && /authorization/.test(noAuth.message), 'accepted lesson cannot bypass #134 workflow authorization');

  // Issue a real router capability and promote the accepted lesson.
  const promotionSession = 'loop-promotion-session';
  const kernel = spawnSync(process.execPath, [
    path.join(ROOT, 'harness-everything/scripts/kernel-router.js'),
  ], {
    cwd: workspace,
    encoding: 'utf8',
    input: JSON.stringify({
      session_id: promotionSession,
      cwd: workspace,
      prompt: 'Persist this lesson as memory after resolving the verified recovery.',
    }),
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
  });
  const capabilityMatch = String(kernel.stdout || '').match(/Memory capability \(single-use, workflow\/session-bound\): ([A-Za-z0-9_-]+)/);
  check(kernel.status === 0 && Boolean(capabilityMatch), 'kernel issues a real #134 single-use persistence capability');

  // The new router prompt intentionally starts a fresh bounded workflow in the
  // same session. Promotion consumes that current trusted authorization.
  const promotion = promoteCandidate({
    workspace,
    sessionId: verifierSession,
    candidateId: verifierCandidate.candidateId,
    authorization: capabilityMatch && capabilityMatch[1],
    retentionDays: 30,
  });
  check(promotion.ok === true && promotion.persisted === true, 'accepted candidate persists only through governed memory writer');

  const promoted = listCandidates({ workspace, sessionId: verifierSession })
    .find(candidate => candidate.candidateId === verifierCandidate.candidateId);
  check(promoted.state === 'persisted', 'candidate lifecycle records governed persistence');

  const memoryIndexFile = path.join(workspace, 'memories', 'repo', 'memory-index.json');
  const memoryIndex = JSON.parse(fs.readFileSync(memoryIndexFile, 'utf8'));
  const memoryRecord = memoryIndex.records.find(record => record.source === `lesson-candidate:${verifierCandidate.candidateId}`);
  check(Boolean(memoryRecord), 'durable memory retains lesson-candidate provenance for later retrieval correlation');
  check(memoryRecord.writer.sessionId === promotionSession, 'durable memory distinguishes promotion authorization session from originating recovery session');

  const afterPromotion = listCandidates({ workspace, sessionId: verifierSession })
    .find(candidate => candidate.candidateId === verifierCandidate.candidateId);
  check(afterPromotion.persistence.promotionWriter.sessionId === promotionSession, 'lesson lifecycle retains authorized promotion writer provenance');

  const retrievedMemory = retrieveMemoryRecords({
    workspace,
    task: 'repair path recovery test',
    requirement: 'REQ-141',
    role: 'coordinator',
  });
  check(retrievedMemory.included.some(record => record.origin?.lessonCandidateId === verifierCandidate.candidateId), 'later scoped retrieval correlates durable memory back to originating lesson candidate');

  // Outcome transitions require explicit evidence and preserve distinct states.
  observeCandidate({
    workspace,
    sessionId: verifierSession,
    candidateId: verifierCandidate.candidateId,
    outcome: 'retrieved',
    evidence: 'retrieval-fixture:REQ-141',
  });
  const validated = observeCandidate({
    workspace,
    sessionId: verifierSession,
    candidateId: verifierCandidate.candidateId,
    outcome: 'validated',
    evidence: 'paired-evidence:pending-reference',
  });
  check(validated.candidate.state === 'validated', 'retrieval and downstream outcome remain explicit lifecycle states');
  check(validated.candidate.history.some(entry => entry.state === 'retrieved'), 'candidate history retains retrieval transition');

  // Idempotence: identical runtime evidence must not duplicate candidates.
  const duplicate = createLearningOpportunity(
    { cwd: workspace, session_id: ruleSession },
    {
      triggerType: 'rule-of-3-recovery',
      sourceEventIds: ruleCandidate.trigger.sourceEventIds,
      evidence: ruleCandidate.evidence,
    },
  );
  check(duplicate.created === false, 'identical source evidence is idempotent and does not duplicate lesson candidates');

} finally {
  if (previousStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = previousStateHome;
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(stateHome, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: #141 self-evolve closed loop Phase 1-3 (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
