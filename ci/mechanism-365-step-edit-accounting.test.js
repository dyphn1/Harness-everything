#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-365-step-edit-'));

function run(command, args, cwd, env, input) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: input === undefined ? undefined : JSON.stringify(input),
    timeout: 30000,
  });
}

function mustRun(command, args, cwd, env, input) {
  const result = run(command, args, cwd, env, input);
  assert.strictEqual(result.status, 0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function startContext(runtimeRoot, packaged, pilot) {
  const label = `${packaged ? 'packaged' : 'source'}-${pilot ? 'pilot-on' : 'pilot-off'}`;
  const repo = path.join(tempRoot, label, 'repo');
  const stateHome = path.join(tempRoot, label, 'state');
  const fakeHome = path.join(tempRoot, label, 'home');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });

  const env = {
    HARNESS_STATE_HOME: stateHome,
    HARNESS_WORKSPACE_ROOT: repo,
    HARNESS_DOC_RECONCILIATION_PILOT: pilot ? '1' : '0',
    HARNESS_365_EVIDENCE: 'expanded',
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CLAUDE: '1',
  };
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.PLUGIN_ROOT;

  mustRun('git', ['init', '-b', 'main'], repo, env);
  mustRun('git', ['config', 'user.name', 'Harness #365 Test'], repo, env);
  mustRun('git', ['config', 'user.email', 'harness-365@example.invalid'], repo, env);
  fs.writeFileSync(path.join(repo, 'README.md'), 'baseline\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'harness-365-verification-fixture',
    version: '1.0.0',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2) + '\n');
  mustRun('git', ['add', 'README.md', 'package.json'], repo, env);
  mustRun('git', ['commit', '-m', 'seed verification fixture'], repo, env);

  const kernel = packaged
    ? path.join(runtimeRoot, 'skills/harness-everything/scripts/kernel-router.js')
    : path.join(runtimeRoot, 'harness-everything/scripts/kernel-router.js');
  const controller = path.join(runtimeRoot, 'hooks/scripts/workflow-disposition.js');
  const sessionId = `pm2-365-${label}`;
  const routePayload = {
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionId,
    cwd: repo,
    prompt: 'Fix this checkout bug and add a regression test.',
  };
  mustRun(process.execPath, [kernel], repo, env, routePayload);

  const requirements = [
    { id: 'req-behavior', stepType: 'behavior-change', summary: 'Record the behavior change', acceptance: 'the behavior change is recorded' },
    { id: 'req-doc', stepType: 'doc-change', summary: 'Record the documentation change', acceptance: 'the documentation change is recorded' },
    { id: 'req-expansion', stepType: 'behavior-change', summary: 'Record a shell expansion control', acceptance: 'the shell expansion control is recorded' },
    { id: 'req-percent', stepType: 'behavior-change', summary: 'Record a Windows expansion control', acceptance: 'the percent expansion control is recorded' },
    { id: 'req-blocked', stepType: 'doc-change', summary: 'Record a blocked step control', acceptance: 'the blocked step is recorded' },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'verification evidence is recorded' },
  ];
  mustRun(process.execPath, [controller, 'plan', '--session-id', sessionId,
    '--requirements-json', JSON.stringify(requirements), '--strategy', 'iterative-single',
    '--evidence', 'mechanism test plan'], repo, env);
  mustRun(process.execPath, [controller, 'start', '--session-id', sessionId], repo, env);
  mustRun(process.execPath, [controller, 'binding', '--session-id', sessionId,
    '--step-id', 'req-behavior', '--binding-id', 'tdd', '--disposition', 'loaded',
    '--evidence', 'the packaged TDD skill is available'], repo, env);

  process.env.HARNESS_STATE_HOME = stateHome;
  const { getSessionDir } = require(path.join(runtimeRoot, 'hooks/scripts/lib/harness-state.js'));
  const payload = { session_id: sessionId, cwd: repo };
  const sessionDir = getSessionDir(repo, sessionId, payload);
  return { label, repo, env, controller, sessionId, payload, sessionDir,
    handoffFile: path.join(sessionDir, 'handoff-state.json'),
    obligationsFile: path.join(sessionDir, 'workflow-obligations.json') };
}

function state(context) {
  return JSON.parse(fs.readFileSync(context.handoffFile, 'utf8'));
}

function hook(context, runtimeRoot, script, payload) {
  return mustRun(process.execPath, [path.join(runtimeRoot, `hooks/scripts/${script}`)],
    context.repo, context.env, { ...context.payload, ...payload });
}

function shell(context, command) {
  return spawnSync(command, {
    cwd: context.repo,
    encoding: 'utf8',
    env: { ...process.env, ...context.env },
    shell: true,
    timeout: 30000,
  });
}

function shellEvent(context, runtimeRoot, command, result) {
  return hook(context, runtimeRoot, 'state-persist.js', {
    hook_event_name: result.status === 0 ? 'PostToolUse' : 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { exitCode: result.status, stdout: result.stdout, stderr: result.stderr },
  });
}

function verifyFresh(context, runtimeRoot, label) {
  const changed = path.join(context.repo, `${label}.js`);
  fs.writeFileSync(changed, `// ${label}\n`);
  hook(context, runtimeRoot, 'state-persist.js', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: changed },
  });
  const edited = state(context);
  assert.ok(edited.lastEditAt, `${context.label}: direct edit is recorded`);

  const verification = shell(context, 'npm test');
  assert.strictEqual(verification.status, 0, `${context.label}: fixture npm test succeeds`);
  shellEvent(context, runtimeRoot, 'npm test', verification);
  const fresh = state(context);
  assert.ok(fresh.lastVerifyAt >= fresh.lastEditAt,
    `${context.label}: successful verification follows the edit`);
  return fresh;
}

function stepCommand(context, stepId, disposition = 'pass') {
  return `node "${context.controller}" step --session-id "${context.sessionId}" ` +
    `--step-id "${stepId}" --disposition ${disposition} --evidence "recorded by the mechanism test"`;
}

function blockedStepCommand(context, stepId) {
  return 'node "' + context.controller + '" step --session-id "' + context.sessionId + '" ' +
    '--step-id "' + stepId + '" --disposition blocked --reason-code test-blocked ' +
    '--evidence "recorded by the mechanism test"';
}

function percentStepCommand(context, stepId) {
  return 'node "' + context.controller + '" step --session-id "' + context.sessionId + '" ' +
    '--step-id "' + stepId + '" --disposition pass --evidence "%HARNESS_365_EVIDENCE%"';
}

function stopMessages(context, runtimeRoot) {
  const basic = hook(context, runtimeRoot, 'stop-gate.js', { hook_event_name: 'Stop' });
  const workflow = hook(context, runtimeRoot, 'workflow-stop-gate.js', { hook_event_name: 'Stop' });
  return `${basic.stdout}\n${basic.stderr}\n${workflow.stdout}\n${workflow.stderr}`;
}

function assertFreshStops(context, runtimeRoot, label) {
  const messages = stopMessages(context, runtimeRoot);
  assert.doesNotMatch(messages, /verification after edit|verification-after-edit-missing|no observed successful verification/i,
    `${context.label}: ${label} leaves both Stop hooks fresh\n${messages}`);
}

function assertStaleStops(context, runtimeRoot, label) {
  const messages = stopMessages(context, runtimeRoot);
  assert.match(messages, /no observed successful verification after the latest edit/i,
    `${context.label}: ${label} makes the ordinary Stop remind\n${messages}`);
  assert.match(messages, /verification-after-edit-missing/i,
    `${context.label}: ${label} makes the workflow Stop remind\n${messages}`);
}

function waitPast(timestamp) {
  while (Date.now() <= timestamp) {}
}

function nonStepEscapeControl(context, runtimeRoot, packaged) {
  const sessionId = context.sessionId + '-fable';
  const kernel = packaged
    ? path.join(runtimeRoot, 'skills/harness-everything/scripts/kernel-router.js')
    : path.join(runtimeRoot, 'harness-everything/scripts/kernel-router.js');
  const payload = {
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionId,
    cwd: context.repo,
    prompt: 'Refactor the entire authentication architecture in dependent stages.',
  };
  mustRun(process.execPath, [kernel], context.repo, context.env, payload);
  mustRun(process.execPath, [context.controller, 'plan', '--session-id', sessionId,
    '--requirements-json', JSON.stringify([
      { id: 'req-implement', stepType: 'behavior-change', summary: 'Implement the change', acceptance: 'the change is implemented' },
      { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'verification evidence is recorded' },
    ]), '--strategy', 'fable-staged', '--evidence', 'dependent fixture stages'], context.repo, context.env);

  const { getSessionDir } = require(path.join(runtimeRoot, 'hooks/scripts/lib/harness-state.js'));
  const sessionDir = getSessionDir(context.repo, sessionId, payload);
  fs.writeFileSync(path.join(sessionDir, 'workflow-stages.json'), JSON.stringify([
    {
      stageId: 'implement', goal: 'implement a bounded fixture change', agent: 'fable-worker-sonnet',
      task: 'prepare the run artifact control', dependsOn: [], writeSet: ['generated.js'], inputs: [],
      expectedOutputs: ['generated.js'], requiredBindings: [], optionalBindings: [],
      checkCommand: 'node fixture-check.js', passCondition: 'exit 0',
    },
    {
      stageId: 'verify', goal: 'verify the fixture change', agent: 'fable-verifier',
      task: 'independently verify the fixture', dependsOn: ['implement'], writeSet: [],
      inputs: ['generated.js'], expectedOutputs: ['verification evidence'], requiredBindings: [],
      optionalBindings: [], checkCommand: 'node verifier-check.js', passCondition: 'exit 0',
    },
  ], null, 2));
  mustRun(process.execPath, [context.controller, 'start', '--session-id', sessionId], context.repo, context.env);

  const consumerPath = path.join(runtimeRoot, packaged
    ? 'skills/fable-mode/scripts/workflow-plan-consumer.js'
    : 'fable-mode/scripts/workflow-plan-consumer.js');
  const consumer = require(consumerPath);
  const workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8'));
  const runRoot = path.join(consumer.getWorkspaceStateRoot(context.repo), 'fable-runs', workflow.runId);
  assert.ok(fs.existsSync(path.join(runRoot, 'contracts', 'implement.json')),
    context.label + ': non-step start writes stage run artifacts');

  const fableContext = {
    ...context,
    sessionId,
    payload: { session_id: sessionId, cwd: context.repo },
    sessionDir,
    handoffFile: path.join(sessionDir, 'handoff-state.json'),
  };
  const fresh = verifyFresh(fableContext, runtimeRoot, 'fable-escape-control');
  waitPast(fresh.lastVerifyAt);
  const escapeCommand = 'node "' + context.controller + '" escape --session-id "' + sessionId + '" ' +
    '--stage-id implement --reason-code workflow-uncovered-scope --scope "fixture scope" ' +
    '--evidence "write a run escape artifact"';
  const escape = shell(fableContext, escapeCommand);
  assert.strictEqual(escape.status, 0, context.label + ': non-step escape operation succeeds\n' + escape.stderr);
  shellEvent(fableContext, runtimeRoot, escapeCommand, escape);
  assert.ok(state(fableContext).lastEditAt > fresh.lastVerifyAt,
    context.label + ': non-step workflow operation advances lastEditAt');
  assert.ok(fs.existsSync(path.join(runRoot, 'escapes', 'implement.json')),
    context.label + ': non-step workflow operation writes its run artifact');
  const basic = hook(fableContext, runtimeRoot, 'stop-gate.js', { hook_event_name: 'Stop' });
  const workflowStop = hook(fableContext, runtimeRoot, 'workflow-stop-gate.js', { hook_event_name: 'Stop' });
  assert.match(basic.stderr, /no observed successful verification after the latest edit/i,
    context.label + ': non-step operation makes the ordinary Stop remind');
  assert.match(workflowStop.stderr, /Workflow Reminder/,
    context.label + ': non-step operation leaves unresolved Fable evidence visible');
}

function checkTrace(runtimeRoot, packaged, pilot) {
  const context = startContext(runtimeRoot, packaged, pilot);
  const first = verifyFresh(context, runtimeRoot, 'initial-edit');

  const readOnly = shell(context, 'git status --short');
  assert.strictEqual(readOnly.status, 0, `${context.label}: read-only git status succeeds`);
  shellEvent(context, runtimeRoot, 'git status --short', readOnly);
  assert.strictEqual(state(context).lastEditAt, first.lastEditAt,
    `${context.label}: read-only command does not advance lastEditAt`);
  assertFreshStops(context, runtimeRoot, 'read-only command');

  const step = shell(context, stepCommand(context, 'req-behavior'));
  assert.strictEqual(step.status, 0, `${context.label}: installed workflow step succeeds\n${step.stderr}`);
  shellEvent(context, runtimeRoot, stepCommand(context, 'req-behavior'), step);
  assert.strictEqual(state(context).lastEditAt, first.lastEditAt,
    `${context.label}: installed metadata-only step does not advance lastEditAt`);
  const obligations = JSON.parse(fs.readFileSync(context.obligationsFile, 'utf8'));
  assert.strictEqual(obligations.requirements.find(item => item.id === 'req-behavior').status, 'pass',
    `${context.label}: installed step still records its workflow-state disposition`);
  assertFreshStops(context, runtimeRoot, 'installed step recording');

  let fresh = verifyFresh(context, runtimeRoot, 'edit-control');
  waitPast(fresh.lastVerifyAt);
  const realEdit = path.join(context.repo, 'real-edit.js');
  fs.writeFileSync(realEdit, 'real edit\n');
  hook(context, runtimeRoot, 'state-persist.js', {
    hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: realEdit },
  });
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: real Edit advances lastEditAt`);
  assertStaleStops(context, runtimeRoot, 'real Edit after verification');

  fresh = verifyFresh(context, runtimeRoot, 'chain-control');
  waitPast(fresh.lastVerifyAt);
  const chained = `${stepCommand(context, 'req-doc')} && echo x > "${path.join(context.repo, 'chained.txt')}"`;
  const chainedResult = shell(context, chained);
  assert.strictEqual(chainedResult.status, 0, `${context.label}: step plus chained mutation succeeds\n${chainedResult.stderr}`);
  shellEvent(context, runtimeRoot, chained, chainedResult);
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: chained mutation advances lastEditAt`);
  assertStaleStops(context, runtimeRoot, 'chained mutation');

  fresh = verifyFresh(context, runtimeRoot, 'newline-chain-control');
  waitPast(fresh.lastVerifyAt);
  const newlineMutator = path.join(context.repo, 'newline-mutate.sh');
  fs.writeFileSync(newlineMutator, `#!/bin/sh\necho x > "${path.join(context.repo, 'newline-chained.txt')}"\n`);
  fs.chmodSync(newlineMutator, 0o755);
  const newlineChained = `node "${context.controller}" step --session-id "${context.sessionId}" ` +
    '--step-id "req-doc" --disposition pass --evidence\n./newline-mutate.sh';
  const newlineResult = shell(context, newlineChained);
  assert.strictEqual(newlineResult.status, 0, `${context.label}: newline-separated mutation succeeds\n${newlineResult.stderr}`);
  shellEvent(context, runtimeRoot, newlineChained, newlineResult);
  assert.ok(fs.existsSync(path.join(context.repo, 'newline-chained.txt')), `${context.label}: newline-separated mutation ran`);
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: newline-separated mutation advances lastEditAt`);
  assertStaleStops(context, runtimeRoot, 'newline-separated mutation');

  mustRun(process.execPath, [context.controller, 'binding', '--session-id', context.sessionId,
    '--step-id', 'req-expansion', '--binding-id', 'tdd', '--disposition', 'loaded',
    '--evidence', 'the packaged TDD skill is available'], context.repo, context.env);
  fresh = verifyFresh(context, runtimeRoot, 'expansion-control');
  waitPast(fresh.lastVerifyAt);
  const expansion = `${stepCommand(context, 'req-expansion').replace('recorded by the mechanism test', '$(echo expanded)')}`;
  const expansionResult = shell(context, expansion);
  assert.strictEqual(expansionResult.status, 0, `${context.label}: quoted shell expansion step succeeds\n${expansionResult.stderr}`);
  shellEvent(context, runtimeRoot, expansion, expansionResult);
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: shell expansion is not mistaken for a metadata-only command`);
  assertStaleStops(context, runtimeRoot, 'quoted shell expansion');

  mustRun(process.execPath, [context.controller, 'binding', '--session-id', context.sessionId,
    '--step-id', 'req-percent', '--binding-id', 'tdd', '--disposition', 'loaded',
    '--evidence', 'the packaged TDD skill is available'], context.repo, context.env);
  fresh = verifyFresh(context, runtimeRoot, 'percent-expansion-control');
  waitPast(fresh.lastVerifyAt);
  const percentCommand = percentStepCommand(context, 'req-percent');
  const percent = shell(context, percentCommand);
  assert.strictEqual(percent.status, 0, `${context.label}: percent expansion step succeeds\n${percent.stderr}`);
  shellEvent(context, runtimeRoot, percentCommand, percent);
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: percent expansion cannot bypass edit accounting`);
  assertStaleStops(context, runtimeRoot, 'percent expansion');

  fresh = verifyFresh(context, runtimeRoot, 'blocked-step-control');
  waitPast(fresh.lastVerifyAt);
  const blockedCommand = blockedStepCommand(context, 'req-blocked');
  const blocked = shell(context, blockedCommand);
  assert.strictEqual(blocked.status, 0, `${context.label}: installed blocked step succeeds\n${blocked.stderr}`);
  shellEvent(context, runtimeRoot, blockedCommand, blocked);
  assert.strictEqual(state(context).lastEditAt, fresh.lastEditAt,
    `${context.label}: installed blocked step does not advance lastEditAt`);
  const blockedObligations = JSON.parse(fs.readFileSync(context.obligationsFile, 'utf8'));
  assert.strictEqual(blockedObligations.requirements.find(item => item.id === 'req-blocked').status, 'blocked',
    `${context.label}: installed blocked step still records its workflow state`);
  assertFreshStops(context, runtimeRoot, 'installed blocked step recording');

  fresh = verifyFresh(context, runtimeRoot, 'lookalike-control');
  waitPast(fresh.lastVerifyAt);
  const lookalike = path.join(tempRoot, 'outside', 'workflow-disposition.js');
  fs.mkdirSync(path.dirname(lookalike), { recursive: true });
  fs.writeFileSync(lookalike, 'process.exit(0);\n');
  const lookalikeCommand = `node "${lookalike}" step --session-id "${context.sessionId}" ` +
    '--step-id "req-doc" --disposition pass --evidence "lookalike"';
  const lookalikeResult = shell(context, lookalikeCommand);
  assert.strictEqual(lookalikeResult.status, 0, `${context.label}: lookalike script succeeds`);
  shellEvent(context, runtimeRoot, lookalikeCommand, lookalikeResult);
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: lookalike script advances lastEditAt`);
  assertStaleStops(context, runtimeRoot, 'lookalike workflow script');

  fresh = verifyFresh(context, runtimeRoot, 'non-step-control');
  waitPast(fresh.lastVerifyAt);
  const nonStepCommand = `node "${context.controller}" block --session-id "${context.sessionId}" --evidence "blocked by mechanism test"`;
  const nonStep = shell(context, nonStepCommand);
  assert.strictEqual(nonStep.status, 0, `${context.label}: non-step workflow operation succeeds`);
  shellEvent(context, runtimeRoot, nonStepCommand, nonStep);
  assert.ok(state(context).lastEditAt > fresh.lastVerifyAt,
    `${context.label}: non-step workflow operation advances lastEditAt`);
  assertStaleStops(context, runtimeRoot, 'non-step workflow operation');
  nonStepEscapeControl(context, runtimeRoot, packaged);
  console.log(`PASS ${context.label}: exact step, read-only, Edit, chain, lookalike, and non-step controls`);
}

try {
  for (const packaged of [false, true]) {
    const runtimeRoot = packaged ? path.join(ROOT, 'plugins/harness-everything') : ROOT;
    for (const pilot of [false, true]) checkTrace(runtimeRoot, packaged, pilot);
  }
  console.log('PASS #365 step edit-accounting mechanism test');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
