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

function issueMemoryCapability(workflow) {
  if (!workflow || !workflow.workflowPlan || workflow.workflowPlan.memory?.write === 'none') {
    if (workflow) delete workflow.memoryAuthorization;
    return null;
  }
  const token = crypto.randomBytes(24).toString('base64url');
  workflow.memoryAuthorization = {
    schemaVersion: 1,
    capabilityHash: crypto.createHash('sha256').update(token, 'utf8').digest('hex'),
    writerRole: 'coordinator',
    sessionId: workflow.sessionId,
    workflowId: workflow.workflowId,
    writeDisposition: workflow.workflowPlan.memory.write,
    issuedAt: new Date().toISOString(),
    usedAt: null,
  };
  return token;
}

// Host-generated background-task notifications arrive as UserPromptSubmit
// hook payloads but are not user input (#168). Routing them like prompts
// replaces the workflow contract mid-turn (e.g. deferred -> a new Tier-2).
// A prompt that is entirely a notification envelope must never create or
// replace a workflow; the current contract is kept unchanged.
function isHostNotificationPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return false;
  return /^<task-notification[\s>][\s\S]*<\/task-notification>\s*$/i.test(text);
}

function persistWorkflow(plan, payload, prompt) {
  if (!payload || !(payload.session_id || payload.sessionId)) return null;
  const { runtime, hooksRoot } = loadRuntime();
  const context = runtime.loadWorkflow(payload);
  const { writeCurrentSession } = require(path.join(hooksRoot, 'lib/harness-state'));
  writeCurrentSession(context.root, context.sessionId);
  if (isHostNotificationPrompt(prompt)) {
    return { ...context, hooksRoot, retained: true, hostNotification: true };
  }
  if (context.workflow && runtime.OPEN_STATES.has(context.workflow.state)) {
    if (!context.workflow.workflowPlan) throw new Error('legacy unresolved workflow needs explicit migration; refusing to replace its obligations');
    // Steering/status prompts cannot drop an unresolved execution contract.
    // Stronger new work is retained as a pending route until explicit replan.
    if (runtime.isMajorWorkflow(plan) && !runtime.isMajorWorkflow(context.workflow)) {
      context.workflow.pendingPlan = plan;
      context.workflow.planningWarning = 'stronger-route-suggested';
    }
    context.workflow.lastPromptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 24);
    const memoryCapability = issueMemoryCapability(context.workflow);
    runtime.saveWorkflow(context);
    return { ...context, hooksRoot, retained: true, memoryCapability };
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
    state: selected ? 'pending' : 'deferred',
    planningWarnings: plan.fallback?.disposition === 'none' ? [] : [...(plan.fallback?.reasonCodes || [])],
    runId: null,
    revision: 0,
    escapes: [],
    guidance: {
      mode: 'advisory-workflow',
      reasoningPolicy: 'model-controls-how',
      hardBoundaries: ['rule-of-3-reflection', 'user-host-permission'],
    },
  };
  const memoryCapability = issueMemoryCapability(context.workflow);
  runtime.saveWorkflow(context);
  return { ...context, hooksRoot, retained: false, memoryCapability };
}

function run(raw) {
  const promptArg = process.argv.slice(2).join(' ');
  let payload = null;
  if (raw.trim()) {
    try { payload = JSON.parse(raw); } catch (_) { console.error('[Workflow Router] Invalid hook payload; lifecycle persistence unavailable.'); }
  }
  const prompt = promptArg || (typeof payload?.prompt === 'string' ? payload.prompt : '');
  const hostNotification = isHostNotificationPrompt(prompt);
  // Host-generated notifications are lifecycle events, not user-authored task
  // input. Never feed their text into the router: when there is an active
  // contract we retain it below; when there is none, the event is a no-op.
  const result = hostNotification ? null : core.route(promptArg, raw || null);
  let plan = result?.contract?.workflowPlan || null;
  let persisted = null;
  let failure = null;
  try {
    persisted = persistWorkflow(plan, payload, prompt);
    if (persisted?.retained && persisted.workflow) plan = persisted.workflow.workflowPlan;
  } catch (error) { failure = error; }
  if (hostNotification && !persisted?.workflow) {
    console.log('\n=> Host notification — no active execution contract; ignored for routing.');
    if (failure) console.error('[Workflow Reminder] routing state was not persisted: ' + failure.message);
    return;
  }
  if (result?.sanitized) console.log(result.sanitized);
  if (result?.stderr) process.stderr.write(result.stderr);
  if (persisted?.hostNotification) console.log('\n=> Host notification — routing unchanged; keeping the active execution contract.');
  else if (persisted?.retained) console.log('\n=> Retaining unresolved workflow from earlier prompts; the checkpoint below is the active execution contract.');
  core.printWorkflowPlan(plan);
  core.printRoutingCheckpoint(plan);
  core.printKernelContract(plan);
  console.log('\n=> WORKFLOW GUIDANCE (ADVISORY WHEN SELECTED):');
  console.log('   - State: ' + (persisted?.workflow.state || (plan.strategy ? 'unpersisted' : 'deferred')));
  console.log('   - Selected workflow: ' + (plan.strategy || 'deferred'));
  if (plan.strategySelection === 'selected') {
    console.log('   - Use the selected workflow as planning guidance; reasoning and implementation remain flexible.');
    console.log('   - Before claiming completion, review unresolved workflow evidence and objective verification.');
    console.log('   - If you skip a suggested step, keep the reason explicit and evidence-based.');
    console.log('   - Tier 3 / Fable changes are safer in a linked Git worktree; missing isolation is a strong reminder, not a Harness lock.');
    console.log('   - Escape/replan metadata remains useful for audit, but it does not create a persistent execution lock.');
  }
  if (persisted?.workflow) {
    const controller = path.join(persisted.hooksRoot, 'workflow-disposition.js');
    console.log('   - Workflow id: ' + persisted.workflow.workflowId);
    console.log('   - Memory write disposition: ' + (persisted.workflow.workflowPlan.memory?.write || 'none'));
    if (persisted.memoryCapability) console.log('   - Memory capability (single-use, workflow/session-bound): ' + persisted.memoryCapability);
    console.log('   - Stage specification: ' + path.join(persisted.sessionDir, 'workflow-stages.json'));
    console.log('   - Enter/replan: node "' + controller + '" start --session-id "' + persisted.sessionId + '"');
    if (plan.strategySelection === 'selected' && ['tier2', 'tier3'].includes(plan.tier) && !String(plan.strategy || '').startsWith('fable-')) {
      console.log('   - Obligation state: ' + path.join(persisted.sessionDir, 'workflow-obligations.json'));
      console.log('   - Resolution contract: required obligations need explicit evidence-backed dispositions; this does not block tools.');
      console.log('   - Record disposition: node "' + controller + '" obligation --session-id "' + persisted.sessionId + '" --obligation-id "<id>" --disposition pass --evidence "<evidence>"');
    }
    console.log('   - Escape one declared stage: node "' + controller + '" escape --session-id "' + persisted.sessionId + '" --stage-id "<id>" --reason-code workflow-uncovered-scope --scope "<uncovered scope>" --evidence "<evidence>"');
  } else {
    console.log('   - Runtime state was not persisted; reminders may be less precise, but execution remains available.');
  }
  if (failure) console.error('[Workflow Reminder] routing state was not persisted: ' + failure.message);
  if (result && result.status !== 0) console.error('[Workflow Reminder] router returned status ' + result.status + '; guidance is degraded, not blocking.');
}

if (typeof module !== 'undefined') module.exports = { isHostNotificationPrompt };

if (process.argv.length > 2 || process.stdin.isTTY) run('');
else {  let input = '';
  let finished = false;
  const finish = () => { if (finished) return; finished = true; clearTimeout(timeout); run(input); };
  const timeout = setTimeout(finish, 500);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}
