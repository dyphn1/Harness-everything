#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const plugin = process.argv.includes('--plugin');
const runtimeRoot = plugin ? path.join(ROOT, 'plugins/harness-everything') : ROOT;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-workflow-lifecycle-'));
const repo = path.join(temp, 'repo');
const linked = path.join(temp, 'linked');
fs.mkdirSync(repo);
const env = { ...process.env, HARNESS_STATE_HOME: path.join(temp, 'state'), HARNESS_WORKSPACE_ROOT: repo };
process.env.HARNESS_STATE_HOME = env.HARNESS_STATE_HOME;
const state = require(path.join(runtimeRoot, 'hooks/scripts/lib/harness-state'));
const workflowRuntime = require(path.join(runtimeRoot, 'hooks/scripts/lib/workflow-runtime'));
const workflowIsolation = require(path.join(runtimeRoot, 'hooks/scripts/lib/workflow-isolation'));
const sessionId = 'workflow-lifecycle';
const payload = { session_id: sessionId, cwd: repo };
const sessionDir = state.getSessionDir(repo, sessionId);
const file = path.join(sessionDir, 'workflow-run.json');
const read = target => JSON.parse(fs.readFileSync(target, 'utf8'));
const write = (target, value) => fs.writeFileSync(target, JSON.stringify(value));
let passed = 0;
function check(value, message) { assert.ok(value, message); passed++; console.log('PASS ' + message); }
function node(script, input, args = []) {
  const relative = plugin && script.startsWith('harness-everything/') ? 'skills/' + script : script;
  return spawnSync(process.execPath, [path.join(runtimeRoot, relative), ...args], { cwd: repo, env, input: input && JSON.stringify(input), encoding: 'utf8' });
}
function git(args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
}
const route = prompt => node('harness-everything/scripts/kernel-router.js', { ...payload, prompt });
const gate = (tool, input, cwd = linked) => node('hooks/scripts/workflow-gate.js', { ...payload, cwd, tool_name: tool, tool_input: input });
const persistDirect = (tool, input, cwd = repo, response = {}) => node('hooks/scripts/state-persist.js', {
  ...payload,
  cwd,
  hook_event_name: 'PostToolUse',
  tool_name: tool,
  tool_input: input,
  tool_response: response,
});
let toolUseSeq = 0;
function beginShell(command, cwd = repo) {
  const toolUseId = 'toolu_fixture_' + (++toolUseSeq);
  const input = { ...payload, cwd, tool_name: 'Bash', tool_use_id: toolUseId, tool_input: { command } };
  return { command, cwd, toolUseId, result: node('hooks/scripts/workflow-gate.js', input) };
}
function persistShell(call, response = {}, hookEvent = 'PostToolUse') {
  const input = {
    ...payload,
    cwd: call.cwd,
    hook_event_name: hookEvent,
    tool_name: 'Bash',
    tool_use_id: call.toolUseId,
    tool_input: { command: call.command },
  };
  if (hookEvent === 'PostToolUseFailure') {
    input.error = response.error || 'Exit code 1\nfixture failure';
    input.is_interrupt = Boolean(response.is_interrupt);
  } else {
    input.tool_response = response;
  }
  return node('hooks/scripts/state-persist.js', input);
}
function denyShell(call) {
  return node('hooks/scripts/workflow-mutation-denied.js', {
    ...payload,
    cwd: call.cwd,
    hook_event_name: 'PermissionDenied',
    permission_mode: 'auto',
    tool_name: 'Bash',
    tool_use_id: call.toolUseId,
    tool_input: { command: call.command },
    reason: 'Blocked by classifier',
  });
}
const probeDir = path.join(sessionDir, 'mutation-probes');
const probeFiles = () => {
  try { return fs.readdirSync(probeDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
  catch (_) { return []; }
};
const stop = extra => node('hooks/scripts/workflow-stop-gate.js', { ...payload, ...extra });
const control = (...args) => node('hooks/scripts/workflow-disposition.js', null, [args[0], '--session-id', sessionId, ...args.slice(1)]);
function fixtureSession(fixtureSessionId) {
  const fixturePayload = { session_id: fixtureSessionId, cwd: repo };
  const fixtureSessionDir = state.getSessionDir(repo, fixtureSessionId);
  const fixtureFile = path.join(fixtureSessionDir, 'workflow-run.json');
  return {
    payload: fixturePayload,
    file: fixtureFile,
    sessionDir: fixtureSessionDir,
    route: prompt => node('harness-everything/scripts/kernel-router.js', { ...fixturePayload, prompt }),
    gate: (tool, input, extra = {}) => node('hooks/scripts/workflow-gate.js', { ...fixturePayload, ...extra, tool_name: tool, tool_input: input }),
    persist: (tool, input, response = {}, extra = {}) => node('hooks/scripts/state-persist.js', {
      ...fixturePayload,
      ...extra,
      hook_event_name: 'PostToolUse',
      tool_name: tool,
      tool_input: input,
      tool_response: response,
    }),
    stop: extra => node('hooks/scripts/workflow-stop-gate.js', { ...fixturePayload, ...extra }),
    control: (...args) => node('hooks/scripts/workflow-disposition.js', null, [args[0], '--session-id', fixtureSessionId, ...args.slice(1)]),
  };
}
const stages = [
  { stageId: 'build', goal: 'fix', agent: 'fable-worker', task: 'fix bounded module', dependsOn: [], writeSet: ['src'], checkCommand: 'node test-build.js', passCondition: 'exit 0' },
  { stageId: 'optional', goal: 'external scope', agent: 'fable-worker', task: 'external task', dependsOn: [], writeSet: [], checkCommand: 'node external.js', passCondition: 'exit 0' },
  { stageId: 'verify', goal: 'verify', agent: 'fable-verifier', task: 'independent review', dependsOn: ['build', 'optional'], writeSet: [], checkCommand: 'node verify.js', passCondition: 'exit 0' },
];

try {
  // #162: Tier-2 shell accounting must degrade conservatively when a workspace
  // is not a Git repository. Lack of a Git fingerprint is not an isolation
  // violation for a non-major workflow.
  const nonGit = fixtureSession('workflow-non-git');
  check(nonGit.route('Fix this checkout bug with a regression test').status === 0 &&
    read(nonGit.file).strategy === 'iterative-single',
    '#162 non-git fixture routes to Tier 2 iterative workflow');
  check(nonGit.control('start').status === 0 && read(nonGit.file).state === 'running',
    '#162 non-git Tier 2 workflow starts normally');
  let nonGitIterations = read(nonGit.file).budget?.counters?.iterations || 0;
  for (const [index, command] of ['npm --version', 'node -e "process.exit(0)"', 'cd .', 'git init -q'].entries()) {
    const toolUseId = 'toolu_non_git_pre_' + index;
    const admitted = nonGit.gate('Bash', { command }, { tool_use_id: toolUseId });
    check(admitted.status === 0, '#162 non-git Tier 2 admits untrusted shell: ' + command);
    const afterGate = read(nonGit.file);
    check(afterGate.budget.counters.iterations === ++nonGitIterations &&
      afterGate.lastMutationAt > 0 &&
      afterGate.budget.events.at(-1)?.evidence === 'shell:unobservable-workspace',
      '#162 unobservable non-git shell is conservatively counted once: ' + command);
    check(nonGit.persist('Bash', { command }, { stdout: 'fixture success' }, { tool_use_id: toolUseId }).status === 0,
      '#162 non-git shell PostToolUse stays fail-open without a probe: ' + command);
  }

  // A probe may have been created while Git was observable and become
  // unobservable before PostToolUse (for example .git disappears). Tier 2
  // must settle it conservatively instead of blocking the workflow.
  const lostObservationId = 'toolu_non_git_post_fallback';
  const lostObservationPayload = {
    ...nonGit.payload,
    tool_name: 'Bash',
    tool_use_id: lostObservationId,
    tool_input: { command: 'node lost-observation.js' },
  };
  const lostObservationContext = workflowRuntime.loadWorkflow(lostObservationPayload);
  const lostObservationKey = workflowIsolation.shellProbeKey(lostObservationPayload, repo);
  workflowRuntime.registerMutationProbe(lostObservationContext, lostObservationKey, 'f'.repeat(64), true);
  const beforeLostObservation = read(nonGit.file);
  check(nonGit.persist('Bash', { command: 'node lost-observation.js' }, { stdout: 'fixture success' },
    { tool_use_id: lostObservationId }).status === 0,
    '#162 Tier 2 PostToolUse degrades when workspace observation becomes unavailable');
  const afterLostObservation = read(nonGit.file);
  check(afterLostObservation.state === 'running' &&
    afterLostObservation.budget.counters.iterations === beforeLostObservation.budget.counters.iterations + 1 &&
    afterLostObservation.lastMutationAt >= (beforeLostObservation.lastMutationAt || 0),
    '#162 lost post-observation is settled as one conservative mutation without blocking');

  const nonGitTarget = path.join(repo, 'non-git-edit.txt');
  check(nonGit.gate('Write', { file_path: nonGitTarget }).status === 0,
    '#162 direct edit remains available in non-git Tier 2');
  fs.writeFileSync(nonGitTarget, 'changed\n');
  check(nonGit.persist('Write', { file_path: nonGitTarget }).status === 0,
    '#162 direct non-git edit persists mutation milestone');
  const verifyId = 'toolu_non_git_verify';
  check(nonGit.gate('Bash', { command: 'node run-test.js' }, { tool_use_id: verifyId }).status === 0,
    '#162 verification shell is admitted in non-git Tier 2');
  check(nonGit.persist('Bash', { command: 'node run-test.js' }, { stdout: 'tests passed' },
    { tool_use_id: verifyId }).status === 0,
    '#162 non-git verification result is persisted');
  check(nonGit.stop().status === 0 && read(nonGit.file).state === 'satisfied',
    '#162 edit then verification can satisfy Stop in non-git Tier 2');

  const nonGitMajor = fixtureSession('workflow-non-git-major');
  check(nonGitMajor.route('Refactor the entire authentication architecture across all services without fable').status === 0 &&
    read(nonGitMajor.file).tier === 'tier3',
    '#162 non-git major fixture routes to Tier 3');
  check(nonGitMajor.control('start').status === 0 && read(nonGitMajor.file).state === 'running',
    '#162 non-Fable Tier 3 controller can enter running state before mutation');
  const majorBlocked = nonGitMajor.gate('Bash', { command: 'node mutate.js' }, { tool_use_id: 'toolu_non_git_major' });
  check(majorBlocked.status === 2 && /Git worktree isolation/i.test(majorBlocked.stderr),
    '#162 non-git Tier 3 remains fail-closed with an isolation-specific error');

  fs.unlinkSync(nonGitTarget);
  git(['init']); fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n'); git(['add', '.']);
  git(['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', 'commit', '-m', 'fixture']);
  git(['worktree', 'add', linked, '-b', 'isolated']);
  const taskNotification = '<task-notification><summary>Background command "Run full test suite" failed with exit code 1</summary></task-notification>';
  const unboundNotification = node('harness-everything/scripts/kernel-router.js', { cwd: repo, prompt: taskNotification });
  check(unboundNotification.status === 0 &&
    unboundNotification.stdout.includes('ignored for routing') &&
    !unboundNotification.stdout.includes('WORKFLOW EXECUTION CONTRACT'),
    'host notification without session binding is a routing no-op');
  const noWorkflowNotification = route(taskNotification);
  check(noWorkflowNotification.status === 0 && !fs.existsSync(file),
    'host notification with no active workflow creates no contract');
  check(noWorkflowNotification.stdout.includes('ignored for routing') &&
    !noWorkflowNotification.stdout.includes('iterative-single') &&
    !noWorkflowNotification.stdout.includes('WORKFLOW EXECUTION CONTRACT'),
    'host notification with no active workflow emits no notification-derived routing contract');

  const routed = route('Refactor the entire repository architecture in dependent stages.');
  check(routed.status === 0, 'prompt hook creates workflow');
  const initial = read(file);
  check(initial.state === 'pending' && initial.workflowId && initial.strategy === 'fable-staged', 'selected route is pending with identity');
  check(initial.requiredInvariants.includes('stage-contracts') && initial.requiredInvariants.includes('isolated-worktree-before-mutation'), 'persisted contract retains full invariant set');
  check(!fs.readFileSync(file, 'utf8').includes('Refactor the entire'), 'state stores prompt hash without prompt text');
  check(gate('Write', { file_path: path.join(linked, 'src.js') }).status === 2, 'Fable entry is required even inside worktree');
  check(stop().status === 2, 'cannot stop before entry');
  check(route('continue').status === 0 && read(file).workflowId === initial.workflowId, 'continuation does not erase active obligation');
  check(route('Update one README typo').status === 0 && read(file).strategy === 'fable-staged', 'simple prompt cannot downgrade unresolved workflow');
  const spec = path.join(sessionDir, 'workflow-stages.json');
  check(gate('Write', { file_path: spec }, repo).status === 0, 'bounded stage specification can be bootstrapped without source mutation');
  fs.linkSync(path.join(repo, 'README.md'), spec);
  check(gate('Write', { file_path: spec }, repo).status === 2, 'bootstrap file cannot alias a primary-tree artifact');
  fs.unlinkSync(spec);
  check(gate('Write', { file_path: file }, repo).status === 2, 'bootstrap exception excludes active workflow state');
  write(spec, stages);
  const command = `node "${path.join(runtimeRoot, 'hooks/scripts/workflow-disposition.js')}" start --session-id ${sessionId}`;
  check(gate('Bash', { command }, repo).status === 0, 'trusted controller can start from bound primary root');
  check(gate('Bash', { command: command + ' && rm src.js' }, repo).status === 2, 'controller prefix cannot hide shell execution');
  const started = control('start');
  check(started.status === 0, 'controller starts a real Fable run: ' + started.stderr);
  const active = read(file);
  const runRoot = path.join(state.getStateRoot(repo), 'fable-runs', active.runId);
  const runFile = path.join(runRoot, 'run.json');
  const manifest = read(runFile);
  check(manifest.workflowId === active.workflowId && manifest.sessionId === sessionId, 'run is explicitly bound to workflow and session');
  const allowedMutation = gate('Write', { file_path: path.join(linked, 'src.js') });
  check(allowedMutation.status === 0, 'entered workflow allows isolated artifact mutation: ' + allowedMutation.stderr);
  for (const invalid of [{ sessionId: null }, { workflowId: 'unrelated' }, { createdAt: 'invalid' }]) {
    write(runFile, { ...manifest, ...invalid });
    check(stop().status === 2, 'uncorrelated run cannot satisfy completion: ' + JSON.stringify(invalid));
  }
  write(runFile, manifest);
  check(control('escape', '--reason-code', 'routine', '--scope', 'task', '--evidence', 'easy').status === 2, 'confidence escape rejected');
  check(control('escape', '--reason-code', 'workflow-uncovered-scope', '--scope', 'task', '--evidence', 'uncovered').status === 2, 'unscoped whole-workflow escape rejected');
  check(control('escape', '--stage-id', 'optional', '--reason-code', 'workflow-uncovered-scope', '--scope', 'external observation', '--evidence', 'fixture external host unavailable').status === 0, 'scoped evidence-backed exception is recorded');
  check(read(file).state === 'running' && stop().status === 2, 'escape leaves covered obligations unresolved');
  check(gate('Write', { file_path: path.join(repo, 'src.js') }, repo).status === 2, 'actual escape command cannot waive isolation');
  check(control('escape', '--stage-id', 'verify', '--reason-code', 'host-capability-unavailable', '--scope', 'verifier', '--evidence', 'missing host').status === 2, 'required verifier cannot be escaped');
  function observe(stage, worker, exitCode) {
    return node('hooks/scripts/contract-test.js', { ...payload, worker_id: worker, tool_name: 'Bash', tool_input: { command: stages.find(item => item.stageId === stage).checkCommand }, tool_response: { exitCode, stdout: 'fixture evidence' } });
  }
  check(observe('verify', 'reviewer', 0).status === 2, 'verifier cannot pass ahead of its dependency');
  check(observe('build', 'builder', 1).status === 2 && stop().status === 2, 'failed objective check prevents completion');
  check(observe('build', 'builder', 0).status === 0, 'failed stage may recover with observed passing evidence');
  check(observe('verify', 'reviewer', 0).status === 0, 'independent verifier evidence is observed');
  const buildFile = path.join(runRoot, 'contracts/build.json');
  const savedBuild = read(buildFile);
  fs.unlinkSync(buildFile);
  check(stop().status === 2, 'deleted contract cannot make remaining directory entries look complete');
  write(buildFile, savedBuild);
  const evidenceFile = path.join(runRoot, 'evidence/build.json');
  const savedEvidence = read(evidenceFile);
  write(evidenceFile, { ...savedEvidence, exitCode: null });
  check(stop().status === 2, 'status pass without observed exit zero is insufficient');
  write(evidenceFile, savedEvidence);
  const mutationState = read(file);
  write(file, { ...mutationState, lastMutationAt: Date.now() + 10000 });
  check(stop().status === 2, 'verification predating a new mutation is stale');
  write(file, mutationState);
  check(stop().status === 0 && read(file).state === 'satisfied', 'all covered stages and verifier resolve workflow to satisfied');
  const satisfiedWorkflow = read(file);
  const satisfiedNotification = route(taskNotification);
  check(satisfiedNotification.status === 0 &&
    read(file).workflowId === satisfiedWorkflow.workflowId &&
    read(file).state === 'satisfied',
    'satisfied workflow followed by host notification keeps the same satisfied contract');
  check(!satisfiedNotification.stdout.includes('Run full test suite') &&
    satisfiedNotification.stdout.includes('routing unchanged'),
    'satisfied host notification text is not routed as new work');
  check(route('Refactor the entire repository architecture in dependent stages.').status === 0 && read(file).workflowId !== initial.workflowId, 'next completed-task boundary creates a fresh workflow');
  check(stop({ stop_hook_active: true }).status === 0 && read(file).state === 'blocked', 'Stop retry reports blocked instead of faking completion');
  check(gate('Write', { file_path: path.join(linked, 'src.js') }).status === 2, 'blocked state still prohibits mutation');
  for (let i = 0; i < 3; i++) { check(control('start').status === 0, 'bounded replan attempt ' + i); control('block', '--evidence', 'fixture blocker'); }
  check(control('start').status === 2 && read(file).state === 'blocked', 'exhausted replan budget remains blocked');
  check(read(file).budget?.state === 'budget-exhausted' && read(file).budget?.reasonCode === 'replan-budget-exhausted', 'Fable replan exhaustion is auditable before recovery');
  const dispositionPath = path.join(runtimeRoot, 'hooks/scripts/workflow-disposition.js');
  const resetCommand = `node "${dispositionPath}" reset-budget --session-id ${sessionId} --evidence fixture-fable-budget-reset`;
  check(gate('Bash', { command: resetCommand }, repo).status === 0, 'blocked Fable workflow admits trusted reset-budget controller through gate');
  check(gate('Bash', { command: resetCommand + ' && echo bypass' }, repo).status === 2, 'controller shell chaining is not exempted');
  check(gate('Bash', { command: resetCommand + ' | echo bypass' }, repo).status === 2, 'controller pipe composition is not exempted');
  check(gate('Bash', { command: `node "${dispositionPath}" reset-budget --session-id ${sessionId} --evidence $(echo bypass)` }, repo).status === 2, 'controller command substitution is not exempted');
  check(gate('Bash', { command: `node "${path.join(runtimeRoot, 'hooks/scripts/not-workflow-disposition.js')}" reset-budget --session-id ${sessionId} --evidence wrong-path` }, repo).status === 2, 'wrong controller script path is not exempted');
  check(control('reset-budget', '--evidence', 'fixture-fable-budget-reset').status === 0, 'reset-budget executes after gate admission');
  const fableReset = read(file);
  check(fableReset.state === 'pending' && fableReset.budget?.state === 'active' && fableReset.budget?.epoch === 1, 'budget reset returns Fable workflow to pending with audited epoch');
  check(gate('Write', { file_path: path.join(repo, 'still-primary.js') }, repo).status === 2, 'budget reset does not weaken primary-tree worktree isolation');
  const restartCommand = `node "${dispositionPath}" start --session-id ${sessionId}`;
  check(gate('Bash', { command: restartCommand }, repo).status === 0, 'trusted start controller remains admitted after reset');
  check(control('start').status === 0 && read(file).state === 'running', 'Fable workflow resumes after audited budget reset');
  const revisionCommand = `node "${dispositionPath}" revision --session-id ${sessionId} --evidence fixture-revision`;
  check(gate('Bash', { command: revisionCommand }, repo).status === 0, 'revision controller is admitted through workflow gate');
  check(control('revision', '--evidence', 'fixture-revision').status === 0 && read(file).budget?.counters?.revisionRounds === 1, 'revision controller reaches budget accounting');
  fs.writeFileSync(file, '{broken');
  check(route('continue').status === 2 && fs.readFileSync(file, 'utf8') === '{broken', 'router cannot overwrite unreadable unresolved state');
  check(stop().status === 2, 'malformed state cannot silently pass completion');
  write(file, { state: 'active' });
  check(gate('Write', { file_path: path.join(linked, 'src.js') }).status === 2 && stop().status === 2, 'partial JSON state cannot bypass workflow gates');
  fs.unlinkSync(file);
  check(route('Fix this checkout bug with a regression test').status === 0 && read(file).strategy === 'iterative-single', 'bounded fix selects iterative lifecycle');
  const activeTier2 = read(file);
  check(activeTier2.tier === 'tier2' && activeTier2.mutationIsolation?.required === false && !workflowRuntime.isMajorWorkflow(activeTier2), 'Tier 2 iterative workflow starts non-major');
  check(route('Refactor the entire repository architecture in dependent stages.').status === 0, 'stronger Tier 3 route is retained for explicit replan');
  const queuedTier3 = read(file);
  check(queuedTier3.state === 'blocked' && queuedTier3.pendingPlan?.tier === 'tier3' && queuedTier3.pendingPlan?.mutationIsolation?.required === true, 'stronger Tier 3 plan is queued as pending only');
  check(queuedTier3.workflowPlan?.tier === 'tier2' && queuedTier3.strategy === 'iterative-single' &&
    queuedTier3.mutationIsolation?.required === false, 'pending Tier 3 plan does not overwrite active Tier 2 fields');
  check(!workflowRuntime.isMajorWorkflow(queuedTier3), 'major-workflow classification follows the authoritative active plan, not pending metadata');
  write(spec, stages);
  check(control('start').status === 0, 'explicit replan activates queued Tier 3 plan');
  const promotedTier3 = read(file);
  check(promotedTier3.workflowPlan?.tier === 'tier3' && promotedTier3.strategy.startsWith('fable-') &&
    promotedTier3.mutationIsolation?.required === true && !promotedTier3.pendingPlan, 'pending Tier 3 isolation becomes active atomically on start');
  check(workflowRuntime.isMajorWorkflow(promotedTier3), 'major-workflow classification flips only after explicit activation');
  check(gate('Write', { file_path: path.join(repo, 'premature-primary.js') }, repo).status === 2, 'activated Tier 3 plan still blocks primary-tree mutation');
  fs.unlinkSync(file);
  check(route('Fix this checkout bug with a regression test').status === 0 && read(file).strategy === 'iterative-single', 'fresh bounded fix returns to Tier 2 iterative lifecycle');
  let tier2 = read(file);
  const tier2WorkflowId = tier2.workflowId;
  write(file, { ...tier2, state: 'deferred' });
  const deferredNotification = route(taskNotification);
  check(deferredNotification.status === 0 &&
    read(file).workflowId === tier2WorkflowId &&
    read(file).state === 'deferred',
    'deferred workflow followed by host notification keeps the same deferred contract');
  check(!deferredNotification.stdout.includes('Run full test suite') &&
    deferredNotification.stdout.includes('routing unchanged'),
    'deferred host notification text is not routed as new work');
  write(file, tier2);

  const iterationLimit = read(file).workflowPlan.limits.maxIterations;
  check(Number.isInteger(iterationLimit) && iterationLimit > 0, 'iterative route exposes a numeric iteration budget');

  // #165: direct Edit/Write/apply_patch accounting follows workspace effects.
  // Bookkeeping outside the repository must not consume Tier-2 iterations or
  // advance workflow/Stop-gate mutation milestones.
  const handoffFile = path.join(sessionDir, 'handoff-state.json');
  const outsideTarget = path.join(temp, 'scratch-note.txt');
  const beforeOutside = read(file);
  const beforeOutsideIterations = beforeOutside.budget?.counters?.iterations || 0;
  const beforeOutsideMutationAt = beforeOutside.lastMutationAt || 0;
  const beforeOutsideEditAt = fs.existsSync(handoffFile) ? (read(handoffFile).lastEditAt || 0) : 0;
  for (let i = 0; i < 3; i++) {
    check(gate('Write', { file_path: outsideTarget }, repo).status === 0,
      'out-of-workspace Write is admitted without Tier-2 mutation accounting');
    fs.writeFileSync(outsideTarget, 'scratch ' + i + '\n');
    const outsideResponse = i === 0
      ? { stderr: 'warning: successful bookkeeping write emitted diagnostic text' }
      : {};
    check(persistDirect('Write', { file_path: outsideTarget }, repo, outsideResponse).status === 0,
      'out-of-workspace Write post-tool state persists without mutation milestone');
  }
  const afterOutside = read(file);
  const afterOutsideHandoff = read(handoffFile);
  check((afterOutside.budget?.counters?.iterations || 0) === beforeOutsideIterations &&
    (afterOutside.lastMutationAt || 0) === beforeOutsideMutationAt &&
    (afterOutsideHandoff.lastEditAt || 0) === beforeOutsideEditAt &&
    afterOutsideHandoff.status !== 'failed',
    'out-of-workspace Writes leave iterations/milestones unchanged and PostToolUse stderr is not a failure');
  check(stop().status === 0, 'out-of-workspace-only bookkeeping does not force verification before Stop');

  check(route('Fix this checkout bug with a regression test').status === 0 && read(file).strategy === 'iterative-single',
    'real follow-up user prompt after notification/accounting checks routes normally');
  let observedDirectIterations = read(file).budget?.counters?.iterations || 0;
  const internalTarget = path.join(repo, 'direct-inside.txt');
  const beforeInternalMutationAt = read(file).lastMutationAt || 0;
  check(gate('Write', { file_path: internalTarget }, repo).status === 0, 'in-workspace Write is admitted');
  fs.writeFileSync(internalTarget, 'inside\n');
  check(persistDirect('Write', { file_path: internalTarget }, repo).status === 0, 'in-workspace Write post-tool state persists');
  check(read(file).budget.counters.iterations === ++observedDirectIterations &&
    read(file).lastMutationAt >= beforeInternalMutationAt &&
    read(handoffFile).lastEditAt > beforeOutsideEditAt,
    'in-workspace Write consumes exactly one iteration and advances mutation milestones');

  const mixedPatch = [
    '*** Begin Patch',
    `*** Update File: ${outsideTarget}`,
    '@@',
    '-scratch',
    '+scratch updated',
    `*** Update File: ${path.join(repo, 'README.md')}`,
    '@@',
    '-fixture',
    '+fixture updated',
    '*** End Patch',
  ].join('\n');
  check(gate('apply_patch', { patch: mixedPatch }, repo).status === 0, 'mixed apply_patch is admitted');
  check(persistDirect('apply_patch', { patch: mixedPatch }, repo).status === 0, 'mixed apply_patch post-tool state persists');
  check(read(file).budget.counters.iterations === ++observedDirectIterations,
    'mixed apply_patch counts exactly once when any target is inside the workspace');

  const pureOutsidePatch = [
    '*** Begin Patch',
    `*** Update File: ${outsideTarget}`,
    '@@',
    '-scratch updated',
    '+scratch external only',
    '*** End Patch',
  ].join('\n');
  const beforePureOutside = read(file);
  const beforePureOutsideEditAt = read(handoffFile).lastEditAt || 0;
  check(gate('apply_patch', { patch: pureOutsidePatch }, repo).status === 0, 'pure external apply_patch is admitted');
  check(persistDirect('apply_patch', { patch: pureOutsidePatch }, repo).status === 0, 'pure external apply_patch post-tool state persists');
  check(read(file).budget.counters.iterations === observedDirectIterations &&
    read(file).lastMutationAt === beforePureOutside.lastMutationAt &&
    (read(handoffFile).lastEditAt || 0) === beforePureOutsideEditAt,
    'pure external apply_patch consumes no iteration and advances no mutation milestone');

  const linkedTarget = path.join(linked, 'direct-linked.txt');
  check(gate('Write', { file_path: linkedTarget }, linked).status === 0,
    'Write inside a linked worktree is treated as workspace mutation');
  fs.writeFileSync(linkedTarget, 'linked\n');
  check(persistDirect('Write', { file_path: linkedTarget }, linked).status === 0,
    'linked-worktree Write post-tool state persists');
  check(read(file).budget.counters.iterations === ++observedDirectIterations,
    'linked-worktree Write consumes exactly one iteration');

  // Keep the #165 regression fixture from consuming the budget used by the
  // pre-existing lifecycle/exhaustion assertions below.
  fs.unlinkSync(internalTarget);
  fs.unlinkSync(linkedTarget);
  fs.unlinkSync(file);
  if (fs.existsSync(handoffFile)) fs.unlinkSync(handoffFile);
  check(route('Fix this checkout bug with a regression test').status === 0 &&
    read(file).strategy === 'iterative-single' &&
    (read(file).budget?.counters?.iterations || 0) === 0,
    '#165 regression fixture resets into a fresh Tier-2 lifecycle baseline');

  // #155/#157 regression lock: read-only shell composition, including quoted
  // and escaped separator characters inside arguments, must never look like an
  // iterative mutation or advance the mutation clock.
  const beforeReadOnly = read(file);
  const readOnlyIterations = beforeReadOnly.budget?.counters?.iterations || 0;
  const readOnlyMutationAt = beforeReadOnly.lastMutationAt || 0;
  const quotedReadOnly = [
    'git status --short; git log --oneline -1',
    'gh issue view 1 --repo octocat/hello-world --json number,title 2>&1',
    'grep -n "fixture\\|missing" README.md | head -20',
    "grep -n 'fixture|missing' README.md | head -20",
    'echo "fixture|missing" | grep fixture',
    "grep 'fixture;missing' README.md | head -1",
  ];
  for (let i = 0; i < iterationLimit + 2; i++) {
    const command = quotedReadOnly[i % quotedReadOnly.length];
    check(gate('Bash', { command }, repo).status === 0, 'quoted/escaped read-only shell command stays outside iteration budget: ' + command);
  }
  const afterReadOnly = read(file);
  check((afterReadOnly.budget?.counters?.iterations || 0) === readOnlyIterations,
    'read-only shell composition does not consume iterative budget');
  check((afterReadOnly.lastMutationAt || 0) === readOnlyMutationAt,
    'read-only shell composition does not advance lastMutationAt');

  // #159: safety classification is not mutation evidence. Commands that are
  // not proven read-only are admitted under an opaque workspace probe while
  // capacity remains, then accounted only if the visible workspace changed.
  const untrustedReads = [
    'git fetch origin --quiet 2>&1; git status; git log --oneline -1',
    'git remote -v',
    'gh run view 1 --json status',
    'node -e "console.log(42)"',
  ];
  for (const command of untrustedReads) {
    const before = read(file);
    const call = beginShell(command);
    check(call.result.status === 0, 'untrusted read/query is admitted under observation: ' + command);
    const probes = probeFiles();
    check(probes.length === 1 && !fs.readFileSync(path.join(probeDir, probes[0]), 'utf8').includes(command),
      'mutation probe persists only opaque identity, not raw command text');
    check(persistShell(call).status === 0, 'no-effect shell probe resolves through state-persist: ' + command);
    check(probeFiles().length === 0, 'completed shell call removes its mutation probe');
    const after = read(file);
    check((after.budget?.counters?.iterations || 0) === (before.budget?.counters?.iterations || 0),
      'no-effect untrusted shell command consumes no iteration');
    check((after.lastMutationAt || 0) === (before.lastMutationAt || 0),
      'no-effect untrusted shell command does not advance lastMutationAt');
  }

  const deniedCall = beginShell('node denied-by-auto-mode.js');
  check(deniedCall.result.status === 0 && probeFiles().length === 1,
    'auto-mode candidate reserves mutation capacity before permission decision');
  check(denyShell(deniedCall).status === 0 && probeFiles().length === 0,
    'PermissionDenied releases the exact tool-use mutation probe');
  const parallelA = beginShell('node repeated-read-only-wrapper.js');
  const parallelB = beginShell('node repeated-read-only-wrapper.js');
  check(parallelA.result.status === 0 && parallelB.result.status === 0 && probeFiles().length === 2,
    'identical concurrent shell commands receive distinct tool-use probes');
  check(denyShell(parallelA).status === 0 && persistShell(parallelB).status === 0 && probeFiles().length === 0,
    'parallel tool-use probes settle independently without reservation leakage');

  const metadataFetch = 'git fetch . HEAD:refs/remotes/origin/harness-probe';
  const beforeMetadataFetch = read(file);
  const metadataFetchCall = beginShell(metadataFetch);
  check(metadataFetchCall.result.status === 0,
    'metadata-only git fetch is admitted under observation');
  git(['fetch', '.', 'HEAD:refs/remotes/origin/harness-probe']);
  check(persistShell(metadataFetchCall).status === 0, 'real metadata-only git fetch probe resolves');
  check((read(file).budget?.counters?.iterations || 0) === (beforeMetadataFetch.budget?.counters?.iterations || 0) &&
    (read(file).lastMutationAt || 0) === (beforeMetadataFetch.lastMutationAt || 0),
    'real git fetch changes Git metadata without consuming a code iteration');

  let observedIterations = read(file).budget?.counters?.iterations || 0;
  const mutateTracked = 'node mutate-tracked.js';
  const mutateTrackedCall = beginShell(mutateTracked);
  check(mutateTrackedCall.result.status === 0, 'unknown tracked-file mutator is admitted under observation');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture changed once\n');
  check(persistShell(mutateTrackedCall).status === 0, 'tracked-file mutation is observed');
  check(read(file).budget.counters.iterations === ++observedIterations, 'tracked-file mutation consumes exactly one iteration');
  const firstObservedAt = read(file).lastMutationAt;

  const mutateDirty = 'node mutate-dirty-again.js';
  const mutateDirtyCall = beginShell(mutateDirty);
  check(mutateDirtyCall.result.status === 0, 'unknown already-dirty mutator is admitted under observation');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture changed twice\n');
  check(persistShell(mutateDirtyCall).status === 0, 'already-dirty content change is observed');
  check(read(file).budget.counters.iterations === ++observedIterations && read(file).lastMutationAt >= firstObservedAt,
    'already-dirty content change consumes one new iteration');

  const createUntracked = 'node create-untracked.js';
  const createUntrackedCall = beginShell(createUntracked);
  check(createUntrackedCall.result.status === 0, 'unknown untracked-file mutator is admitted under observation');
  fs.writeFileSync(path.join(repo, 'observed-untracked.txt'), 'one\n');
  check(persistShell(createUntrackedCall).status === 0, 'untracked-file creation is observed');
  check(read(file).budget.counters.iterations === ++observedIterations, 'untracked-file creation consumes exactly one iteration');

  const failedMutation = 'node fail-after-write.js';
  const failedMutationCall = beginShell(failedMutation);
  check(failedMutationCall.result.status === 0, 'failing shell mutator is admitted under observation');
  fs.writeFileSync(path.join(repo, 'observed-failed.txt'), 'written before failure\n');
  check(persistShell(failedMutationCall, { error: 'Exit code 7\nfixture failure' }, 'PostToolUseFailure').status === 0,
    'failed shell command still reports workspace mutation through failure lifecycle');
  check(read(file).budget.counters.iterations === ++observedIterations,
    'failed shell command that changed workspace still consumes one iteration');

  const beforeStageOnly = read(file);
  const stageOnly = 'git add README.md observed-untracked.txt';
  const stageOnlyCall = beginShell(stageOnly);
  check(stageOnlyCall.result.status === 0, 'staging-only git command is observed instead of pre-counted');
  git(['add', 'README.md', 'observed-untracked.txt']);
  check(persistShell(stageOnlyCall).status === 0, 'staging-only probe resolves');
  check(read(file).budget.counters.iterations === beforeStageOnly.budget.counters.iterations,
    'git add does not double-count tracked or previously-untracked visible content');

  const beforeCommitOnly = read(file);
  const commitOnly = 'git commit -m observed-fixture';
  const commitOnlyCall = beginShell(commitOnly);
  check(commitOnlyCall.result.status === 0, 'pure commit is observed instead of pre-counted');
  git(['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', 'commit', '-m', 'observed-fixture']);
  check(persistShell(commitOnlyCall).status === 0, 'pure commit probe resolves');
  check(read(file).budget.counters.iterations === beforeCommitOnly.budget.counters.iterations,
    'pure commit of already-accounted content does not consume another code iteration');

  const deleteTracked = 'node delete-tracked.js';
  const deleteTrackedCall = beginShell(deleteTracked);
  check(deleteTrackedCall.result.status === 0, 'unknown tracked-file deletion is admitted under observation');
  fs.unlinkSync(path.join(repo, 'observed-untracked.txt'));
  check(persistShell(deleteTrackedCall).status === 0, 'tracked-file deletion is observed');
  check(read(file).budget.counters.iterations === ++observedIterations,
    'tracked-file deletion consumes exactly one iteration');

  const beforeStageDelete = read(file);
  const stageDelete = 'git add -u observed-untracked.txt';
  const stageDeleteCall = beginShell(stageDelete);
  check(stageDeleteCall.result.status === 0, 'staging-only deletion is observed instead of pre-counted');
  git(['add', '-u', 'observed-untracked.txt']);
  check(persistShell(stageDeleteCall).status === 0, 'staging deletion probe resolves');
  check(read(file).budget.counters.iterations === beforeStageDelete.budget.counters.iterations,
    'git add -u does not double-count an already-observed deletion');

  observedIterations = read(file).budget.counters.iterations;
  for (let i = observedIterations; i < iterationLimit; i++) {
    check(gate('Write', { file_path: path.join(repo, `small-${i}.js`) }, repo).status === 0, `confirmed mutation ${i + 1}/${iterationLimit} stays within budget`);
  }
  check(gate('Bash', { command: 'git status --short' }, repo).status === 0,
    'proven read-only diagnosis remains allowed at the iteration limit');
  check(gate('Bash', { command: 'git remote -v' }, repo).status === 2,
    'untrusted shell command is blocked before execution once actual mutation budget is full');
  check(gate('Write', { file_path: path.join(repo, 'small-overflow.js') }, repo).status === 2,
    'blocked exhausted workflow still rejects direct mutation');
  const iterativeExhausted = read(file);
  check(iterativeExhausted.state === 'blocked' && iterativeExhausted.budget?.state === 'budget-exhausted' &&
    iterativeExhausted.budget?.reasonCode === 'iteration-budget-exhausted', 'iterative exhaustion records blocked budget state');
  const iterativeResetCommand = `node "${dispositionPath}" reset-budget --session-id ${sessionId} --evidence fixture-iteration-budget-reset`;
  check(gate('Bash', { command: iterativeResetCommand }, repo).status === 0, 'iteration-exhausted workflow admits reset-budget through gate');
  check(control('reset-budget', '--evidence', 'fixture-iteration-budget-reset').status === 0, 'iteration budget reset executes');
  check(read(file).state === 'pending' && read(file).budget?.epoch === 1 && read(file).budget?.counters?.iterations === 0, 'iteration budget reset is audited and clears counters');
  const iterativeStartCommand = `node "${dispositionPath}" start --session-id ${sessionId}`;
  check(gate('Bash', { command: iterativeStartCommand }, repo).status === 0, 'iterative workflow restart is admitted through gate');
  check(control('start').status === 0 && read(file).state === 'running', 'iteration-exhausted workflow resumes after reset');
  check(stop().status === 2, 'direct/iterative route cannot complete unverified mutation');
  check(stop({ stop_hook_active: true }).status === 0 && read(file).state === 'blocked', 'iterative retry reports incomplete state');
  check(control('start').status === 0, 'blocked iterative route can resume without a Fable stage map');
  // #153 + #159 ordering: when one shell command mutates and then verifies,
  // observed mutation must land before state-persist records verification.
  const mutateAndVerify = 'node mutate.js && npm test';
  const mutateAndVerifyCall = beginShell(mutateAndVerify);
  check(mutateAndVerifyCall.result.status === 0, 'combined mutation+verification command is admitted under observation');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture verified mutation\n');
  check(persistShell(mutateAndVerifyCall, { stdout: 'tests passed' }).status === 0,
    'single state-persist handler records mutation before verification');
  check(stop().status === 0 && read(file).state === 'satisfied',
    'verification without a host-reported numeric exit status resolves after same-command mutation');
  node('hooks/scripts/state-persist.js', { ...payload, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exitCode: 0, stdout: 'passed' } });
  check(stop().status === 0 && read(file).state === 'satisfied', 'observed iterative verification resolves completion');
  console.log(`PASS: workflow lifecycle (${passed} assertions)`);
} finally {
  if (!temp.startsWith(path.join(os.tmpdir(), 'harness-workflow-lifecycle-'))) throw new Error('unsafe fixture cleanup');
  fs.rmSync(temp, { recursive: true, force: true });
}
if (!plugin) {
  const packaged = spawnSync(process.execPath, [__filename, '--plugin'], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  assert.strictEqual(packaged.status, 0, packaged.stdout + packaged.stderr);
  console.log('PASS: packaged OpenAI workflow lifecycle mirrors source (' + passed + ' assertions)');
}
