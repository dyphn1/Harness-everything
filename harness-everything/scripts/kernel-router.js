#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parsePayload(raw) {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch (_) {
    return null;
  }
}

function resolvePrompt(argv, payload) {
  if (argv.length > 0) return argv.join(' ');
  return payload && typeof payload.prompt === 'string' ? payload.prompt : '';
}

function loadHarnessState() {
  const candidates = [
    process.env.CLAUDE_PLUGIN_ROOT && path.join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks', 'scripts', 'lib', 'harness-state'),
    process.env.PLUGIN_ROOT && path.join(process.env.PLUGIN_ROOT, 'hooks', 'scripts', 'lib', 'harness-state'),
    path.resolve(__dirname, '..', '..', 'hooks', 'scripts', 'lib', 'harness-state'),
    path.resolve(__dirname, '..', '..', '..', 'hooks', 'scripts', 'lib', 'harness-state'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) { /* try next packaging layout */ }
  }
  return null;
}

function workflowDispositionScript() {
  const candidates = [
    process.env.CLAUDE_PLUGIN_ROOT && path.join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks', 'scripts', 'workflow-disposition.js'),
    process.env.PLUGIN_ROOT && path.join(process.env.PLUGIN_ROOT, 'hooks', 'scripts', 'workflow-disposition.js'),
    path.resolve(__dirname, '..', '..', 'hooks', 'scripts', 'workflow-disposition.js'),
    path.resolve(__dirname, '..', '..', '..', 'hooks', 'scripts', 'workflow-disposition.js'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0] || 'hooks/scripts/workflow-disposition.js';
}

function parseWorkflowPlan(stdout) {
  const match = String(stdout || '').match(/=> ROUTER WORKFLOW PLAN \(JSON\):\s*(\{[^\r\n]+\})/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (_) { return null; }
}

function isMajorWorkflow(plan) {
  return Boolean(plan && (plan.tier === 'tier3' || String(plan.strategy || '').startsWith('fable-')));
}

function augmentRuntimePlan(plan) {
  if (!plan || !isMajorWorkflow(plan)) return plan;
  const requiredInvariants = Array.isArray(plan.requiredInvariants) ? [...plan.requiredInvariants] : [];
  const suggestedSkills = Array.isArray(plan.suggestedSkills) ? [...plan.suggestedSkills] : [];
  if (!requiredInvariants.includes('isolated-worktree-before-mutation')) requiredInvariants.push('isolated-worktree-before-mutation');
  if (!suggestedSkills.includes('using-git-worktrees')) suggestedSkills.push('using-git-worktrees');
  return { ...plan, requiredInvariants, suggestedSkills };
}

function rewriteStructuredPlan(stdout, plan) {
  if (!plan) return String(stdout || '');
  return String(stdout || '').replace(
    /(=> ROUTER WORKFLOW PLAN \(JSON\):\s*)\{[^\r\n]+\}/,
    `$1${JSON.stringify(plan)}`,
  );
}

function rewritePolicy(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map(line => {
      if (line.includes('=> SUGGESTED SKILLS (MANDATORY EVALUATION — ADVISORY EXECUTION):')) {
        return '=> WORKFLOW SKILLS (EVALUATE APPLICABILITY — SELECTED WORKFLOW IS MANDATORY):';
      }
      if (line.includes('Suggestion disposition: execution is advisory after evaluation.')) {
        return '   - Suggestion disposition: individual skill applicability is conditional, but the selected workflow topology is mandatory. A skill may be marked not-applicable only from its evaluated flow; model confidence alone is not an escape.';
      }
      if (line.includes('Use these selectively after evaluation; Tier 3/Fable does not create a universal skill pipeline.')) {
        return '   - Fable is not a universal pipeline, but when the router selects a Fable topology that topology must be entered and resolved before completion.';
      }
      if (line.includes('=> ORCHESTRATION POLICY: Do not enforce workflow order.')) {
        return '=> ORCHESTRATION POLICY: Mandatory applicable workflow. The selected topology is an execution contract; the model controls HOW to satisfy its stages, not WHETHER to execute them. Escape is exception-only for workflow-uncovered scope and must be recorded with evidence.';
      }
      return line;
    })
    .join('\n');
}

function persistWorkflow(plan, payload, promptText) {
  if (!plan || !payload) return null;
  const state = loadHarnessState();
  if (!state) return null;

  try {
    const root = state.getWorkspaceRoot(payload);
    const sessionId = payload.session_id || payload.sessionId || null;
    if (sessionId && typeof state.writeCurrentSession === 'function') state.writeCurrentSession(root, sessionId);
    const sessionDir = state.getSessionDir(root, sessionId, payload);
    const stateFile = path.join(sessionDir, 'workflow-run.json');
    let previous = null;
    if (fs.existsSync(stateFile)) {
      try { previous = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { /* replace malformed state */ }
    }

    const blocked = Boolean(plan.fallback && plan.fallback.disposition === 'blocked');
    const selected = plan.strategySelection === 'selected' && Boolean(plan.strategy);
    const lifecycleState = blocked ? 'blocked' : selected ? 'active' : 'deferred';
    const majorWorkflow = isMajorWorkflow(plan);
    const now = Date.now();
    const record = {
      schemaVersion: 1,
      revision: previous && Number.isInteger(previous.revision) ? previous.revision + 1 : 1,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      sessionId,
      promptHash: crypto.createHash('sha256').update(String(promptText || '')).digest('hex').slice(0, 24),
      tier: plan.tier,
      routingStatus: plan.routingStatus,
      strategy: plan.strategy,
      strategySelection: plan.strategySelection,
      requiredInvariants: Array.isArray(plan.requiredInvariants) ? plan.requiredInvariants : [],
      suggestedSkills: Array.isArray(plan.suggestedSkills) ? plan.suggestedSkills : [],
      verification: plan.verification || null,
      mutationIsolation: {
        required: majorWorkflow,
        mechanism: majorWorkflow ? 'git-worktree' : 'none',
        transition: majorWorkflow ? 'before-first-mutation' : 'not-required',
        onUnavailable: majorWorkflow ? 'blocked' : 'not-applicable',
      },
      fallback: plan.fallback || null,
      state: lifecycleState,
      disposition: null,
      enforcement: {
        mode: 'mandatory-applicable-workflow',
        completionGate: lifecycleState === 'active',
        escapePolicy: 'workflow-uncovered-scope-only',
        reasoningPolicy: 'model-controls-how',
      },
    };
    fs.writeFileSync(stateFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return record;
  } catch (_) {
    return null;
  }
}

function printExecutionContract(plan, persisted) {
  if (!plan) {
    console.log('\n=> WORKFLOW EXECUTION CONTRACT: unavailable because no structured plan could be parsed. Do not infer permission to skip required verification or safety gates.');
    return;
  }

  const blocked = plan.fallback && plan.fallback.disposition === 'blocked';
  const selected = plan.strategySelection === 'selected' && Boolean(plan.strategy);
  const state = blocked ? 'blocked' : selected ? 'active' : 'deferred';
  console.log('\n=> WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED):');
  console.log(`   - State: ${state}`);
  console.log(`   - Selected workflow: ${plan.strategy || 'deferred'}`);
  if (selected && !blocked) {
    console.log('   - Execute the selected workflow to resolution. Do not replace it with a direct path merely because the task feels clear, routine, or easy.');
    console.log('   - Reasoning, tools, decomposition details, and implementation technique remain flexible inside the workflow contract.');
    console.log('   - Completion requires the workflow obligations and objective verification selected by the plan to resolve.');
    if (isMajorWorkflow(plan)) {
      console.log('   - Major-workflow mutation isolation: Git worktree isolation is mandatory before source/artifact mutation. Read-only discovery may stay in the bound repository; before the first mutation, enter an existing linked worktree or create one via using-git-worktrees. If isolation cannot be established, the mutation is BLOCKED — never fall back to the primary working tree.');
    }
    const escape = workflowDispositionScript();
    console.log(`   - Escape is exception-only for genuinely uncovered workflow scope. Record it with evidence: node "${escape}" escape --reason-code workflow-uncovered-scope --scope "<uncovered scope>" --evidence "<why the selected workflow cannot represent it>"`);
  } else if (blocked) {
    console.log('   - The selected route is blocked. Report the blocking reason; do not silently downgrade to a weaker workflow.');
  } else {
    console.log('   - Strategy is deferred. Preserve mandatory invariants and choose the smallest justified workflow from task evidence.');
  }
  if (!persisted && selected) {
    console.log('   - Runtime lifecycle state was not persisted by this host invocation; treat enforcement strength as advisory/unknown for this host, not as proof that the workflow became optional.');
  }
}

function run(rawInput) {
  const argv = process.argv.slice(2);
  const payload = parsePayload(rawInput);
  const core = path.join(__dirname, 'kernel-router-core.js');
  const child = spawnSync(process.execPath, [core, ...argv], {
    input: argv.length > 0 ? undefined : rawInput,
    encoding: 'utf8',
    env: process.env,
  });

  if (child.error) {
    console.error(`[Harness Workflow Router] Failed to execute kernel-router-core.js: ${child.error.message}`);
    process.exit(1);
  }

  const plan = augmentRuntimePlan(parseWorkflowPlan(child.stdout));
  const promptText = resolvePrompt(argv, payload);
  const persisted = persistWorkflow(plan, payload, promptText);
  const rewritten = rewriteStructuredPlan(rewritePolicy(child.stdout), plan);
  process.stdout.write(rewritten);
  if (rewritten && !rewritten.endsWith('\n')) process.stdout.write('\n');
  if (child.stderr) process.stderr.write(child.stderr);
  printExecutionContract(plan, persisted);

  if (child.status !== 0) process.exit(child.status === null ? 1 : child.status);
}

if (process.argv.length > 2 || process.stdin.isTTY) {
  run('');
} else {
  let input = '';
  const timeout = setTimeout(() => run(input), 500);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    run(input);
  });
  process.stdin.on('error', () => {
    clearTimeout(timeout);
    run(input);
  });
}
