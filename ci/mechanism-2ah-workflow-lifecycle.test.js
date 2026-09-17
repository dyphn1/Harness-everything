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
const stop = extra => node('hooks/scripts/workflow-stop-gate.js', { ...payload, ...extra });
const control = (...args) => node('hooks/scripts/workflow-disposition.js', null, [args[0], '--session-id', sessionId, ...args.slice(1)]);
const stages = [
  { stageId: 'build', goal: 'fix', agent: 'fable-worker', task: 'fix bounded module', dependsOn: [], writeSet: ['src'], checkCommand: 'node test-build.js', passCondition: 'exit 0' },
  { stageId: 'optional', goal: 'external scope', agent: 'fable-worker', task: 'external task', dependsOn: [], writeSet: [], checkCommand: 'node external.js', passCondition: 'exit 0' },
  { stageId: 'verify', goal: 'verify', agent: 'fable-verifier', task: 'independent review', dependsOn: ['build', 'optional'], writeSet: [], checkCommand: 'node verify.js', passCondition: 'exit 0' },
];

try {
  git(['init']); fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n'); git(['add', '.']);
  git(['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', 'commit', '-m', 'fixture']);
  git(['worktree', 'add', linked, '-b', 'isolated']);
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
  check(route('Refactor the entire repository architecture in dependent stages.').status === 0 && read(file).workflowId !== initial.workflowId, 'next completed-task boundary creates a fresh workflow');
  check(stop({ stop_hook_active: true }).status === 0 && read(file).state === 'blocked', 'Stop retry reports blocked instead of faking completion');
  check(gate('Write', { file_path: path.join(linked, 'src.js') }).status === 2, 'blocked state still prohibits mutation');
  for (let i = 0; i < 3; i++) { check(control('start').status === 0, 'bounded replan attempt ' + i); control('block', '--evidence', 'fixture blocker'); }
  check(control('start').status === 2 && read(file).state === 'blocked', 'exhausted replan budget remains blocked');
  fs.writeFileSync(file, '{broken');
  check(route('continue').status === 2 && fs.readFileSync(file, 'utf8') === '{broken', 'router cannot overwrite unreadable unresolved state');
  check(stop().status === 2, 'malformed state cannot silently pass completion');
  write(file, { state: 'active' });
  check(gate('Write', { file_path: path.join(linked, 'src.js') }).status === 2 && stop().status === 2, 'partial JSON state cannot bypass workflow gates');
  fs.unlinkSync(file);
  check(route('Fix this checkout bug with a regression test').status === 0 && read(file).strategy === 'iterative-single', 'bounded fix selects iterative lifecycle');
  check(gate('Write', { file_path: path.join(repo, 'small.js') }, repo).status === 0, 'ordinary iterative mutation does not require isolation');
  check(stop().status === 2, 'direct/iterative route cannot complete unverified mutation');
  check(stop({ stop_hook_active: true }).status === 0 && read(file).state === 'blocked', 'iterative retry reports incomplete state');
  check(control('start').status === 0, 'blocked iterative route can resume without a Fable stage map');
  node('hooks/scripts/state-persist.js', { ...payload, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'no code' } });
  check(stop().status === 2, 'verification without numeric exit status is unknown');
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
