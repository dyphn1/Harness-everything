#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadWorkflow, saveWorkflow, matchingRun, OPEN_STATES, WORKFLOW_CONTROLLER_COMMANDS } = require('./lib/workflow-runtime');
const { getWorkspaceRoot, readCurrentSession } = require('./lib/harness-state');
const { atomicWriteJson, readJson } = require('./lib/fable-contracts');
const {
  planningUnresolved,
  recordPlanning,
  materializeExecutionObligations,
  updateObligation,
  updateBinding,
  updateStep,
  activeStepSnapshot,
} = require('./lib/workflow-obligations');

const ALLOWED_ESCAPE_REASONS = new Set(['workflow-uncovered-scope', 'host-capability-unavailable']);

function parseArgs(argv) {
  const args = { command: argv[0] };
  const flags = new Map([
    ['--reason-code', 'reasonCode'], ['--scope', 'scope'], ['--evidence', 'evidence'],
    ['--session-id', 'sessionId'], ['--stage-id', 'stageId'],
    ['--obligation-id', 'obligationId'], ['--disposition', 'disposition'],
    ['--step-id', 'stepId'], ['--binding-id', 'bindingId'],
    ['--requirements-json', 'requirementsJson'], ['--strategy', 'strategy'],
  ]);
  for (let i = 1; i < argv.length; i++) {
    const key = flags.get(argv[i]);
    if (!key || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error('unknown or incomplete argument: ' + argv[i]);
    args[key] = argv[++i];
  }
  return args;
}

function usage() {
  return `Usage: workflow-disposition.js <${[...WORKFLOW_CONTROLLER_COMMANDS].join('|')}> --session-id <id> [--requirements-json <json> --strategy <strategy> --obligation-id <id> --step-id <id> --binding-id <id> --disposition <pass|blocked|escaped|loaded|not-needed|unavailable> --reason-code <reason> --scope <scope> --evidence <evidence>]`;
}

const SELECTABLE_STRATEGIES = new Set(['direct-single', 'iterative-single', 'fable-staged', 'fable-parallel', 'fable-multi-agent-workspace']);

function routerContract() {
  for (const relative of ['../../harness-everything/scripts/router-contract.js', '../../skills/harness-everything/scripts/router-contract.js']) {
    const file = path.resolve(__dirname, relative);
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error('router contract unavailable');
}

function recomposePlan(workflow, requestedStrategy) {
  const strategy = String(requestedStrategy || '').trim();
  if (!SELECTABLE_STRATEGIES.has(strategy)) throw new Error('--strategy must name a supported execution topology');
  if (strategy === workflow.workflowPlan.strategy) return workflow.workflowPlan;
  if (!workflow.taskShape || typeof workflow.taskShape !== 'object') {
    throw new Error('workflow task-shape context is unavailable; cannot safely recompose topology');
  }
  const taskShape = {
    ...workflow.taskShape,
    explicitRequest: {
      ...(workflow.taskShape.explicitRequest || {}),
      strategy,
    },
  };
  return routerContract().buildWorkflowPlan({
    routingStatus: workflow.workflowPlan.routingStatus,
    tier: workflow.tier,
    taskShape,
    actionGateReasonCodes: workflow.workflowPlan.actionGate?.reasonCodes || [],
    reasonCodes: ['post-decomposition-workflow-selection'],
  });
}

function consumer() {
  for (const relative of ['../../fable-mode/scripts/workflow-plan-consumer.js', '../../skills/fable-mode/scripts/workflow-plan-consumer.js']) {
    const file = path.resolve(__dirname, relative);
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error('Fable consumer unavailable');
}

function stageBindingDisposition(context, args) {
  if (!String(context.workflow.strategy || '').startsWith('fable-')) throw new Error('stage bindings are only available on Fable workflows');
  if (context.workflow.state !== 'running') throw new Error('start the selected Fable workflow before resolving stage bindings');
  const match = matchingRun(context);
  if (!match || !match.run.stageIds.includes(args.stageId)) throw new Error('--stage-id must name a stage in the correlated active run');
  if (!['loaded', 'not-needed', 'unavailable'].includes(args.disposition)) throw new Error('--disposition must be loaded, not-needed, or unavailable');
  const evidence = String(args.evidence || '').trim();
  if (!evidence) throw new Error('--evidence is required for every binding disposition');
  const active = consumer().activeStageBindings(match.runRoot, context.workflow.escapes);
  if (!active.some(stage => stage.stageId === args.stageId)) throw new Error('stage bindings may only be resolved for a dependency-ready active stage');
  const contractPath = path.join(match.runRoot, 'contracts', `${args.stageId}.json`);
  const contract = readJson(contractPath);
  if (!contract || contract.runId !== match.run.runId || contract.stageId !== args.stageId) throw new Error('stage contract is missing or uncorrelated');
  const binding = [...(contract.requiredBindings || []), ...(contract.optionalBindings || [])]
    .find(item => item.id === args.bindingId);
  if (!binding) throw new Error('--binding-id must name a binding declared on the stage');
  const required = binding.required !== false;
  if (required && args.disposition === 'not-needed') throw new Error('required bindings cannot be marked not-needed');
  if (!required && args.disposition === 'unavailable') throw new Error('optional bindings require loaded or not-needed disposition');

  let disposition = args.disposition;
  let reasonCode = disposition === 'unavailable' ? String(args.reasonCode || 'binding-unavailable') : null;
  if (disposition === 'loaded') {
    if (!binding.path) {
      disposition = 'unavailable';
      reasonCode = 'binding-path-unknown';
    }
  }
  binding.status = disposition;
  binding.availability = disposition === 'unavailable'
    ? (reasonCode === 'binding-path-unknown' ? 'unknown' : 'unavailable')
    : 'available';
  binding.evidence = evidence;
  binding.reasonCode = reasonCode;
  binding.updatedAt = new Date().toISOString();
  contract.updatedAt = binding.updatedAt;
  atomicWriteJson(contractPath, contract);
  return {
    stageId: contract.stageId,
    binding: { id: binding.id, required, status: binding.status, availability: binding.availability, path: binding.path, reasonCode: binding.reasonCode },
    activeStages: consumer().activeStageBindings(match.runRoot, context.workflow.escapes),
  };
}

function activeStepCommandHints(sessionId, activeStep) {
  if (!activeStep) return null;
  const controller = path.resolve(__filename);
  return {
    resolveBinding: `node "${controller}" binding --session-id "${sessionId}" --step-id "${activeStep.id}" --binding-id "<active-binding-id>" --disposition <loaded|not-needed|unavailable> --evidence "<binding evidence>"`,
    passStep: `node "${controller}" step --session-id "${sessionId}" --step-id "${activeStep.id}" --disposition pass --evidence "<completion evidence>"`,
  };
}

function activatePlan(workflow, plan) {
  workflow.workflowPlan = plan;
  workflow.strategy = plan.strategy;
  workflow.strategySelection = plan.strategySelection;
  workflow.tier = plan.tier;
  workflow.requiredInvariants = plan.requiredInvariants || [];
  workflow.suggestedSkills = plan.suggestedSkills || [];
  workflow.verification = plan.verification;
  workflow.mutationIsolation = plan.mutationIsolation || { required: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!WORKFLOW_CONTROLLER_COMMANDS.has(args.command)) throw new Error(usage());
  const sessionId = args.sessionId || readCurrentSession(getWorkspaceRoot());
  if (!sessionId) throw new Error('no active Harness session; pass --session-id explicitly');
  const context = loadWorkflow({ session_id: sessionId });
  const { workflow } = context;
  if (!workflow || !OPEN_STATES.has(workflow.state)) throw new Error('no unresolved workflow contract exists for this session');

  if (args.command === 'plan') {
    if (!workflow.workflowId || !workflow.workflowPlan) throw new Error('legacy workflow lacks a correlated plan; cannot plan it implicitly');
    if (!['pending', 'active'].includes(workflow.state)) throw new Error('requirements/workflow composition belongs before execution starts');
    const selectedPlan = recomposePlan(workflow, args.strategy);
    const result = recordPlanning(context, args.requirementsJson, selectedPlan, args.strategy, args.evidence);
    saveWorkflow(context);
    process.stdout.write(JSON.stringify({
      state: workflow.state,
      workflowId: workflow.workflowId,
      requirements: result.set.requirements.map(item => ({ id: item.id, summary: item.summary })),
      workflowSelection: result.set.workflowSelection,
      selectedStrategy: result.selectedPlan.strategy,
      blocked: result.blocked,
    }) + '\n');
    return;
  }

  if (args.command === 'start') {
    if (!workflow.workflowId || !workflow.workflowPlan) throw new Error('legacy workflow lacks a correlated plan; cannot start it implicitly');
    if (workflow.state === 'running') throw new Error('workflow already running; record a blocker before replanning');
    const plan = workflow.pendingPlan || workflow.workflowPlan;
    const unresolvedPlanning = planningUnresolved(context, plan);
    if (unresolvedPlanning.length) throw new Error('resolve requirement decomposition/workflow selection first: ' + unresolvedPlanning.join(', '));

    if (!String(plan.strategy || '').startsWith('fable-')) {
      activatePlan(workflow, plan);
      workflow.revision++;
      workflow.state = 'running';
      workflow.escapes = [];
      delete workflow.pendingPlan;
      delete workflow.blockReason;
      const obligations = materializeExecutionObligations(context, plan);
      saveWorkflow(context);
      const activeStep = activeStepSnapshot(obligations);
      process.stdout.write(JSON.stringify({
        state: workflow.state,
        workflowId: workflow.workflowId,
        revision: workflow.revision,
        obligations: obligations ? obligations.obligations.map(item => ({ id: item.id, status: item.status })) : [],
        activeStep,
        activeStepCommands: activeStepCommandHints(sessionId, activeStep),
      }) + '\n');
      return;
    }

    const stages = readJson(path.join(context.sessionDir, 'workflow-stages.json'));
    if (!Array.isArray(stages) || !stages.length) throw new Error('write a non-empty workflow-stages.json stage array at the session path first');
    if (stages.some(stage => !stage.checkCommand || !stage.passCondition)) throw new Error('every required stage needs an objective checkCommand and passCondition');
    if (plan.verification?.independent && !stages.some(stage => stage.agent === 'fable-verifier' && stage.writeSet?.length === 0 &&
        stages.filter(other => other !== stage).every(other => stage.dependsOn?.includes(other.stageId)))) {
      throw new Error('independent verification requires a read-only fable-verifier stage depending on all other stages');
    }
    const run = consumer().prepareRun({
      routerContract: { workflowPlan: plan }, stages, workspaceRoot: context.root,
      sessionId, workflowId: workflow.workflowId,
    });
    activatePlan(workflow, plan);
    workflow.runId = run.runId;
    workflow.revision++;
    workflow.state = 'running';
    workflow.escapes = [];
    delete workflow.pendingPlan;
    delete workflow.blockReason;
  } else if (args.command === 'stage-binding') {
    const result = stageBindingDisposition(context, args);
    saveWorkflow(context);
    process.stdout.write(JSON.stringify({ state: workflow.state, workflowId: workflow.workflowId, runId: workflow.runId, ...result }) + '\n');
    return;
  } else if (args.command === 'obligation') {
    if (String(workflow.strategy || '').startsWith('fable-')) throw new Error('Fable workflows use correlated stage contracts, not generic execution obligations');
    if (workflow.state !== 'running') throw new Error('start the selected workflow before recording execution obligation dispositions');
    const obligation = updateObligation(context, args.obligationId, args.disposition, {
      evidence: args.evidence,
      reasonCode: args.reasonCode,
      scope: args.scope,
    });
    process.stdout.write(JSON.stringify({
      state: workflow.state,
      workflowId: workflow.workflowId,
      obligation: {
        id: obligation.id,
        status: obligation.status,
        reasonCode: obligation.reasonCode,
        evidence: obligation.evidence,
      },
    }) + '\n');
    return;
  } else if (args.command === 'binding') {
    if (String(workflow.strategy || '').startsWith('fable-')) throw new Error('Fable workflows use correlated stage contracts, not generic step bindings');
    if (workflow.state !== 'running') throw new Error('start the selected workflow before resolving step bindings');
    const result = updateBinding(context, args.stepId, args.bindingId, args.disposition, {
      evidence: args.evidence,
      reasonCode: args.reasonCode,
    });
    process.stdout.write(JSON.stringify({
      state: workflow.state,
      workflowId: workflow.workflowId,
      binding: {
        id: result.binding.id,
        status: result.binding.status,
        availability: result.binding.availability,
        evidence: result.binding.evidence,
      },
      activeStep: result.activeStep,
      activeStepCommands: activeStepCommandHints(sessionId, result.activeStep),
    }) + '\n');
    return;
  } else if (args.command === 'step') {
    if (String(workflow.strategy || '').startsWith('fable-')) throw new Error('Fable workflows use correlated stage contracts, not generic step dispositions');
    if (workflow.state !== 'running') throw new Error('start the selected workflow before recording step dispositions');
    const result = updateStep(context, args.stepId, args.disposition, {
      evidence: args.evidence,
      reasonCode: args.reasonCode,
    });
    process.stdout.write(JSON.stringify({
      state: workflow.state,
      workflowId: workflow.workflowId,
      step: {
        id: result.step.id,
        status: result.step.status,
        evidence: result.step.evidence,
      },
      activeStep: result.activeStep,
      activeStepCommands: activeStepCommandHints(sessionId, result.activeStep),
    }) + '\n');
    return;
  } else if (args.command === 'revision') {
    console.error('[Workflow Reminder] Revision requested; no hard revision budget is enforced.');
  } else if (args.command === 'escape') {
    if (!ALLOWED_ESCAPE_REASONS.has(args.reasonCode)) throw new Error('generic simple/routine/already-clear reasons are intentionally rejected');
    if (!args.scope?.trim()) throw new Error('--scope is required');
    if (!args.evidence?.trim()) throw new Error('--evidence is required');
    const match = matchingRun(context);
    if (!match || !match.run.stageIds.includes(args.stageId)) throw new Error('--stage-id must name a stage in the correlated active run');
    const contract = readJson(path.join(match.runRoot, 'contracts', args.stageId + '.json'));
    if (contract?.agent === 'fable-verifier') throw new Error('independent verification cannot be escaped; record BLOCKED when unavailable');
    const disposition = {
      status: 'escaped', stageId: args.stageId, runId: match.run.runId,
      reasonCode: args.reasonCode, uncoveredScope: args.scope.trim(), evidence: args.evidence.trim(), recordedAt: new Date().toISOString(),
    };
    workflow.escapes = [...(workflow.escapes || []).filter(item => item.stageId !== args.stageId), disposition];
    atomicWriteJson(path.join(match.runRoot, 'escapes', args.stageId + '.json'), disposition);
  } else if (args.command === 'block') {
    if (!args.evidence?.trim()) throw new Error('--evidence is required');
    workflow.state = 'blocked';
    workflow.blockReason = args.evidence.trim();
  } else throw new Error(usage());

  saveWorkflow(context);
  const match = matchingRun(context);
  process.stdout.write(JSON.stringify({
    state: workflow.state, workflowId: workflow.workflowId, runId: workflow.runId,
    revision: workflow.revision, escapes: workflow.escapes,
    activeStages: match && String(workflow.strategy || '').startsWith('fable-') ? consumer().activeStageBindings(match.runRoot, workflow.escapes) : undefined,
  }) + '\n');
}

try { main(); } catch (error) { console.error('[Workflow Disposition] ' + error.message); process.exitCode = 2; }
