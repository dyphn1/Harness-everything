#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STAGE_CONTRACT_VERSION = 2;
const FABLE_STRATEGIES = new Set([
  'fable-staged',
  'fable-parallel',
  'fable-multi-agent-workspace',
]);

function canonicalPath(value) {
  const resolved = path.resolve(value || process.cwd());
  try { return fs.realpathSync(resolved); } catch (_) { return resolved; }
}

function getStateHome() {
  return process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
}

// Keep this algorithm identical to scripts/lib/workspace.js. This skill ships
// standalone, so it cannot depend on the source repository being present.
function getWorkspaceKey(root) {
  const real = canonicalPath(root);
  const slug = path.basename(real).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? real.toLowerCase() : real;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  return `${slug}-${hash}`;
}

function getWorkspaceStateRoot(root) {
  return path.join(getStateHome(), 'workspaces', getWorkspaceKey(root), 'state');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableValue(value[key]);
    return acc;
  }, {});
}

function derivePlanId(routerContract) {
  const canonical = JSON.stringify(stableValue(routerContract));
  return `plan-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
}

function sanitizeId(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${label} contains unsupported characters: ${text}`);
  return text.slice(0, 128);
}

function normalizeWritePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('writeSet entries must be non-empty strings');
  let normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  normalized = normalized.replace(/\/+$/g, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`writeSet paths must be repository-relative: ${value}`);
  }
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`writeSet path escapes or ambiguously names repository scope: ${value}`);
  }
  if (/[*?\[\]]/.test(normalized)) {
    throw new Error(`writeSet uses unsupported glob syntax; declare concrete path scopes: ${value}`);
  }
  return normalized;
}

function normalizeStage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('stage must be an object');
  const stageId = sanitizeId(raw.stageId, 'stageId');
  if (typeof raw.goal !== 'string' || !raw.goal.trim()) throw new Error(`${stageId}: goal is required`);
  if (typeof raw.agent !== 'string' || !raw.agent.trim()) throw new Error(`${stageId}: agent is required`);
  if (typeof raw.task !== 'string' || !raw.task.trim()) throw new Error(`${stageId}: task is required`);
  if (!Array.isArray(raw.dependsOn)) throw new Error(`${stageId}: dependsOn must be an array (use [] for a root stage)`);
  if (!Array.isArray(raw.writeSet)) throw new Error(`${stageId}: writeSet must be an array (use [] for read-only)`);

  const dependsOn = [...new Set(raw.dependsOn.map(value => sanitizeId(value, `${stageId}.dependsOn`)))];
  const writeSet = [...new Set(raw.writeSet.map(normalizeWritePath))].sort();

  return {
    stageId,
    goal: raw.goal.trim(),
    agent: raw.agent.trim(),
    task: raw.task.trim(),
    inputs: Array.isArray(raw.inputs) ? raw.inputs : [],
    expectedOutputs: Array.isArray(raw.expectedOutputs) ? raw.expectedOutputs : [],
    outputPath: raw.outputPath === undefined ? null : raw.outputPath,
    dependsOn,
    writeSet,
    checkCommand: typeof raw.checkCommand === 'string' && raw.checkCommand.trim() ? raw.checkCommand.trim() : null,
    passCondition: typeof raw.passCondition === 'string' && raw.passCondition.trim() ? raw.passCondition.trim() : null,
    failureReturn: typeof raw.failureReturn === 'string' && raw.failureReturn.trim()
      ? raw.failureReturn.trim()
      : 'failure summary + evidence + missing prerequisite',
  };
}

function validateStageGraph(stages) {
  const normalized = stages.map(normalizeStage);
  const byId = new Map();
  for (const stage of normalized) {
    if (byId.has(stage.stageId)) throw new Error(`duplicate stageId: ${stage.stageId}`);
    byId.set(stage.stageId, stage);
  }

  for (const stage of normalized) {
    for (const dependency of stage.dependsOn) {
      if (dependency === stage.stageId) throw new Error(`${stage.stageId}: stage cannot depend on itself`);
      if (!byId.has(dependency)) throw new Error(`${stage.stageId}: unresolved dependency ${dependency}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(stageId) {
    if (visiting.has(stageId)) throw new Error(`cyclic stage dependency detected at ${stageId}`);
    if (visited.has(stageId)) return;
    visiting.add(stageId);
    for (const dependency of byId.get(stageId).dependsOn) visit(dependency);
    visiting.delete(stageId);
    visited.add(stageId);
  }
  for (const stage of normalized) visit(stage.stageId);
  return normalized;
}

function pathScopesOverlap(left, right) {
  const a = normalizeWritePath(left);
  const b = normalizeWritePath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validateParallelBatch(stages) {
  for (let i = 0; i < stages.length; i++) {
    for (let j = i + 1; j < stages.length; j++) {
      for (const left of stages[i].writeSet) {
        for (const right of stages[j].writeSet) {
          if (pathScopesOverlap(left, right)) {
            throw new Error(`parallel write-set overlap: ${stages[i].stageId}:${left} conflicts with ${stages[j].stageId}:${right}`);
          }
        }
      }
    }
  }
}

function dependencyBatches(stages, validateWrites, maxBatchSize = Infinity) {
  const byId = new Map(stages.map(stage => [stage.stageId, stage]));
  const remaining = new Set(byId.keys());
  const completed = new Set();
  const batches = [];
  const boundedSize = Number.isInteger(maxBatchSize) && maxBatchSize > 0 ? maxBatchSize : Infinity;

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(stageId => byId.get(stageId).dependsOn.every(dep => completed.has(dep)))
      .sort();
    if (ready.length === 0) throw new Error('unresolved or cyclic dependency graph');
    const readyStages = ready.map(stageId => byId.get(stageId));
    if (validateWrites) validateParallelBatch(readyStages);
    for (let offset = 0; offset < readyStages.length; offset += boundedSize) {
      batches.push(readyStages.slice(offset, offset + boundedSize).map(stage => stage.stageId));
    }
    for (const stageId of ready) {
      remaining.delete(stageId);
      completed.add(stageId);
    }
  }
  return batches;
}

function topologicalBatches(stages, maxWorkers) {
  return dependencyBatches(stages, true, maxWorkers);
}

function sequentialBatches(stages) {
  return dependencyBatches(stages, false).flat().map(stageId => [stageId]);
}

function validateRouterPlan(routerContract) {
  if (!routerContract || typeof routerContract !== 'object' || Array.isArray(routerContract)) {
    throw new Error('router contract must be an object');
  }
  const plan = routerContract.workflowPlan;
  if (!plan || typeof plan !== 'object') throw new Error('router contract is missing workflowPlan');
  if (plan.strategySelection !== 'selected') throw new Error(`workflow strategy is not selected: ${plan.strategySelection}`);
  if (!FABLE_STRATEGIES.has(plan.strategy)) throw new Error(`workflow strategy is not a Fable consumer topology: ${plan.strategy}`);
  if (plan.fallback && plan.fallback.disposition === 'blocked') {
    throw new Error(`workflow plan is blocked: ${(plan.fallback.reasonCodes || []).join(', ') || 'unspecified reason'}`);
  }
  if (plan.strategy === 'fable-parallel' && (!plan.parallelism || plan.parallelism.allowed !== true)) {
    throw new Error('fable-parallel requires workflowPlan.parallelism.allowed=true');
  }
  return plan;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function prepareRun({ routerContract, stages, workspaceRoot, runId, sessionId = null, workflowId = null }) {
  const plan = validateRouterPlan(routerContract);
  const normalizedStages = validateStageGraph(stages || []);
  if (normalizedStages.length === 0) throw new Error('at least one stage contract is required');

  const planId = derivePlanId(routerContract);
  const resolvedRunId = sanitizeId(runId || `run-${crypto.randomUUID()}`, 'runId');
  const root = canonicalPath(workspaceRoot || process.cwd());
  const stateRoot = getWorkspaceStateRoot(root);
  const runRoot = path.join(stateRoot, 'fable-runs', resolvedRunId);
  if (fs.existsSync(runRoot)) throw new Error(`runId already exists in this workspace: ${resolvedRunId}`);

  const batches = plan.strategy === 'fable-parallel'
    ? topologicalBatches(normalizedStages, plan.limits && plan.limits.maxWorkers)
    : sequentialBatches(normalizedStages);

  const createdAt = new Date().toISOString();
  const contractsDir = path.join(runRoot, 'contracts');
  const evidenceDir = path.join(runRoot, 'evidence');
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  for (const stage of normalizedStages) {
    atomicWriteJson(path.join(contractsDir, `${stage.stageId}.json`), {
      schemaVersion: STAGE_CONTRACT_VERSION,
      planId,
      runId: resolvedRunId,
      sessionId: sessionId || null,
      workflowId,
      workspaceRoot: root,
      ...stage,
      workerId: null,
      status: 'planned',
      verificationEvidence: null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const runManifest = {
    schemaVersion: 1,
    planId,
    runId: resolvedRunId,
    sessionId: sessionId || null,
    workflowId,
    workspaceRoot: root,
    workspaceKey: getWorkspaceKey(root),
    strategy: plan.strategy,
    router: {
      routingStatus: plan.routingStatus,
      tier: plan.tier,
      reasonCodes: plan.reasonCodes || [],
    },
    execution: {
      batches,
      parallelism: plan.parallelism,
      verification: plan.verification,
      workspace: plan.workspace,
      memory: plan.memory,
      modelSelection: plan.modelSelection,
      limits: plan.limits,
    },
    stageIds: normalizedStages.map(stage => stage.stageId),
    createdAt,
  };
  atomicWriteJson(path.join(runRoot, 'run.json'), runManifest);
  return { ...runManifest, runRoot };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--plan-file') args.planFile = argv[++i];
    else if (token === '--stages-file') args.stagesFile = argv[++i];
    else if (token === '--root') args.root = argv[++i];
    else if (token === '--run-id') args.runId = argv[++i];
    else if (token === '--session-id') args.sessionId = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return 'Usage: node fable-mode/scripts/workflow-plan-consumer.js --plan-file <router-contract.json> --stages-file <stages.json> [--root <workspace>] [--run-id <id>] [--session-id <id>]';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!args.planFile || !args.stagesFile) throw new Error(usage());
    const routerContract = JSON.parse(fs.readFileSync(path.resolve(args.planFile), 'utf8'));
    const stagesPayload = JSON.parse(fs.readFileSync(path.resolve(args.stagesFile), 'utf8'));
    const stages = Array.isArray(stagesPayload) ? stagesPayload : stagesPayload.stages;
    const manifest = prepareRun({
      routerContract,
      stages,
      workspaceRoot: args.root || process.cwd(),
      runId: args.runId,
      sessionId: args.sessionId || null,
    });
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } catch (err) {
    console.error(`[FABLE PLAN CONSUMER] ${err.message}`);
    process.exit(2);
  }
}

module.exports = {
  STAGE_CONTRACT_VERSION,
  derivePlanId,
  getWorkspaceKey,
  getWorkspaceStateRoot,
  normalizeStage,
  normalizeWritePath,
  pathScopesOverlap,
  prepareRun,
  sequentialBatches,
  topologicalBatches,
  validateParallelBatch,
  validateRouterPlan,
  validateStageGraph,
};
