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
} = require('./lib/workflow-obligations');

const ALLOWED_ESCAPE_REASONS = new Set(['workflow-uncovered-scope', 'host-capability-unavailable']);

function parseArgs(argv) {
  const args = { command: argv[0] };
  const flags = new Map([
    ['--reason-code', 'reasonCode'], ['--scope', 'scope'], ['--evidence', 'evidence'],
    ['--session-id', 'sessionId'], ['--stage-id', 'stageId'],
    ['--obligation-id', 'obligationId'], ['--disposition', 'disposition'],
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
  return `Usage: workflow-disposition.js <${[...WORKFLOW_CONTROLLER_COMMANDS].join('|')}> --session-id <id> [--requirements-json <json> --strategy <strategy> --obligation-id <id> --disposition <pass|escaped|blocked> --reason-code <reason> --scope <scope> --evidence <evidence>]`;
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
      process.stdout.write(JSON.stringify({
        state: workflow.state,
        workflowId: workflow.workflowId,
        revision: workflow.revision,
        obligations: obligations ? obligations.obligations.map(item => ({ id: item.id, status: item.status })) : [],
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
  process.stdout.write(JSON.stringify({ state: workflow.state, workflowId: workflow.workflowId, runId: workflow.runId, revision: workflow.revision, escapes: workflow.escapes }) + '\n');
}

try { main(); } catch (error) { console.error('[Workflow Disposition] ' + error.message); process.exitCode = 2; }
