#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  derivePlanId,
  getWorkspaceKey,
  getWorkspaceStateRoot,
  validateRouterPlan,
} = require('../../fable-mode/scripts/workflow-plan-consumer');

function canonicalPath(value) {
  const resolved = path.resolve(value || process.cwd());
  try { return fs.realpathSync(resolved); } catch (_) { return resolved; }
}

function sanitizeRunId(value) {
  const text = String(value || `run-${crypto.randomUUID()}`).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`runId contains unsupported characters: ${text}`);
  return text.slice(0, 128);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function consumeWorkspacePlan({ routerContract, workspaceRoot, runId }) {
  const plan = validateRouterPlan(routerContract);
  if (plan.strategy !== 'fable-multi-agent-workspace' || !plan.workspace || plan.workspace.required !== true) {
    throw new Error(`workspace consumer requires fable-multi-agent-workspace with workspace.required=true; received ${plan.strategy}`);
  }

  const root = canonicalPath(workspaceRoot || process.cwd());
  const handoffPath = path.join(root, '.ai', 'handoff.json');
  if (!fs.existsSync(handoffPath)) {
    throw new Error('workspace handoff does not exist; run multi-agent-workspace/scripts/scaffold.js first');
  }

  let handoff;
  try {
    handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  } catch (err) {
    throw new Error(`workspace handoff is invalid JSON: ${err.message}`);
  }

  if (!Array.isArray(handoff.selectedAgents) || typeof handoff.memoryIndex !== 'string') {
    throw new Error('workspace handoff is missing existing selectedAgents/memoryIndex contract fields');
  }

  const resolvedRunId = sanitizeRunId(runId);
  const planId = derivePlanId(routerContract);
  const correlation = {
    schemaVersion: 1,
    planId,
    runId: resolvedRunId,
    strategy: plan.strategy,
    workspace: plan.workspace,
    memory: plan.memory,
    rolePolicy: 'existing-workspace-selection',
    updatedAt: new Date().toISOString(),
  };

  // Preserve the existing handoff contract and role/memory ownership. The
  // workflow consumer only adds correlation and the router-owned slices.
  const nextHandoff = {
    ...handoff,
    workflowCorrelation: correlation,
  };
  atomicWriteJson(handoffPath, nextHandoff);

  const workspaceStateDir = path.dirname(getWorkspaceStateRoot(root));
  atomicWriteJson(path.join(workspaceStateDir, 'multi-agent-workspace-runs', `${resolvedRunId}.json`), {
    ...correlation,
    workspaceRoot: root,
    workspaceKey: getWorkspaceKey(root),
    handoffPath,
    selectedAgents: handoff.selectedAgents.map(agent => ({ id: agent.id, provider: agent.provider, source: agent.source })),
    memoryIndex: handoff.memoryIndex,
  });

  return nextHandoff;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--plan-file') args.planFile = argv[++i];
    else if (token === '--root') args.root = argv[++i];
    else if (token === '--run-id') args.runId = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return 'Usage: node multi-agent-workspace/scripts/consume-workflow-plan.js --plan-file <router-contract.json> [--root <workspace>] [--run-id <id>]';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!args.planFile) throw new Error(usage());
    const routerContract = JSON.parse(fs.readFileSync(path.resolve(args.planFile), 'utf8'));
    const handoff = consumeWorkspacePlan({
      routerContract,
      workspaceRoot: args.root || process.cwd(),
      runId: args.runId,
    });
    process.stdout.write(`${JSON.stringify(handoff)}\n`);
  } catch (err) {
    console.error(`[WORKSPACE PLAN CONSUMER] ${err.message}`);
    process.exit(2);
  }
}

module.exports = {
  consumeWorkspacePlan,
};
