#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const core = require('./kernel-router-core');

function loadRuntime() {
  for (const prefix of ['../..', '../../..']) {
    const candidate = path.resolve(__dirname, prefix, 'hooks/scripts/lib/workflow-runtime.js');
    if (fs.existsSync(candidate)) return { runtime: require(candidate), hooksRoot: path.dirname(path.dirname(candidate)) };
  }
  throw new Error('workflow runtime unavailable in this installation');
}

function persistWorkflow(plan, payload, prompt) {
  if (!payload || !(payload.session_id || payload.sessionId)) return null;
  const { runtime, hooksRoot } = loadRuntime();
  const context = runtime.loadWorkflow(payload);
  const { writeCurrentSession } = require(path.join(hooksRoot, 'lib/harness-state'));
  writeCurrentSession(context.root, context.sessionId);
  if (context.workflow && runtime.OPEN_STATES.has(context.workflow.state)) {
    if (!context.workflow.workflowPlan) throw new Error('legacy unresolved workflow needs explicit migration; refusing to replace its obligations');
    // Steering/status prompts cannot drop an unresolved execution contract.
    // Stronger new work is retained as a pending route until explicit replan.
    if (runtime.isMajorWorkflow(plan) && !runtime.isMajorWorkflow(context.workflow)) {
      context.workflow.state = 'blocked';
      context.workflow.pendingPlan = plan;
      context.workflow.blockReason = 'stronger-route-requires-replan';
      context.workflow.mutationIsolation = plan.mutationIsolation;
    }
    context.workflow.lastPromptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 24);
    runtime.saveWorkflow(context);
    return { ...context, hooksRoot, retained: true };
  }
  const selected = plan.strategySelection === 'selected' && Boolean(plan.strategy);
  const now = Date.now();
  context.workflow = {
    schemaVersion: 2,
    workflowId: crypto.randomUUID(),
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    sessionId: context.sessionId,
    promptHash: crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 24),
    tier: plan.tier,
    strategy: plan.strategy,
    strategySelection: plan.strategySelection,
    requiredInvariants: plan.requiredInvariants || [],
    suggestedSkills: plan.suggestedSkills || [],
    verification: plan.verification,
    mutationIsolation: plan.mutationIsolation || { required: false },
    workflowPlan: plan,
    state: plan.fallback?.disposition === 'blocked' ? 'blocked' : selected ? 'pending' : 'deferred',
    runId: null,
    revision: 0,
    escapes: [],
    enforcement: {
      mode: 'mandatory-applicable-workflow',
      escapePolicy: 'scoped-evidence-only',
      reasoningPolicy: 'model-controls-how',
    },
  };
  runtime.saveWorkflow(context);
  return { ...context, hooksRoot, retained: false };
}

function run(raw) {
  const promptArg = process.argv.slice(2).join(' ');
  let payload = null;
  if (raw.trim()) {
    try { payload = JSON.parse(raw); } catch (_) { console.error('[Workflow Router] Invalid hook payload; lifecycle persistence unavailable.'); }
  }
  const prompt = promptArg || (typeof payload?.prompt === 'string' ? payload.prompt : '');
  const result = core.route(promptArg, raw || null);
  let plan = result.contract.workflowPlan;
  let persisted = null;
  let failure = null;
  try {
    persisted = persistWorkflow(plan, payload, prompt);
    if (persisted?.retained) plan = persisted.workflow.workflowPlan;
  } catch (error) { failure = error; }
  if (result.sanitized) console.log(result.sanitized);
  if (result.stderr) process.stderr.write(result.stderr);
  if (persisted?.retained) console.log('\n=> Retaining unresolved workflow from earlier prompts; the checkpoint below is the active execution contract.');
  core.printWorkflowPlan(plan);
  core.printRoutingCheckpoint(plan);
  core.printKernelContract(plan);
  console.log('\n=> WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED):');
  console.log('   - State: ' + (persisted?.workflow.state || (plan.strategy ? 'unpersisted' : 'deferred')));
  console.log('   - Selected workflow: ' + (plan.strategy || 'deferred'));
  if (plan.strategySelection === 'selected') {
    console.log('   - Execute the selected workflow to resolution. Reasoning and implementation remain flexible inside it.');
    console.log('   - Completion requires the workflow obligations and objective verification to resolve.');
    console.log('   - Generic simple/routine/already-clear reasons cannot waive the selected workflow.');
    console.log('   - Tier 3 / Fable source and artifact mutations require Git worktree isolation; unavailable isolation means BLOCKED.');
    console.log('   - Escape is limited to workflow-uncovered-scope or host-capability-unavailable, with stage, scope and evidence; other obligations remain mandatory.');
  }
  if (persisted) {
    const controller = path.join(persisted.hooksRoot, 'workflow-disposition.js');
    console.log('   - Workflow id: ' + persisted.workflow.workflowId);
    console.log('   - Stage specification: ' + path.join(persisted.sessionDir, 'workflow-stages.json'));
    console.log('   - Enter/replan: node "' + controller + '" start --session-id "' + persisted.sessionId + '"');
    console.log('   - Escape one declared stage: node "' + controller + '" escape --session-id "' + persisted.sessionId + '" --stage-id "<id>" --reason-code workflow-uncovered-scope --scope "<uncovered scope>" --evidence "<evidence>"');
  } else {
    console.log('   - Runtime state was not persisted; host enforcement is unavailable/unknown, not proven hard enforcement.');
  }
  if (failure) {
    console.error('[Workflow Router] ' + failure.message);
    process.exitCode = 2;
  } else if (result.status !== 0) process.exitCode = result.status || 1;
}

if (process.argv.length > 2 || process.stdin.isTTY) run('');
else {
  let input = '';
  let finished = false;
  const finish = () => { if (finished) return; finished = true; clearTimeout(timeout); run(input); };
  const timeout = setTimeout(finish, 500);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}
