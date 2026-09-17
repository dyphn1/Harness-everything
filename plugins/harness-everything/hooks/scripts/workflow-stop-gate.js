#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, getStateRoot } = require('./lib/harness-state');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function findMatchingRun(root, workflow, sessionId) {
  try {
    const runsRoot = path.join(getStateRoot(root), 'fable-runs');
    if (!fs.existsSync(runsRoot)) return null;
    let newest = null;
    for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const runRoot = path.join(runsRoot, entry.name);
      const run = readJson(path.join(runRoot, 'run.json'));
      if (!run) continue;
      if (sessionId && run.sessionId && run.sessionId !== sessionId) continue;
      if (run.strategy !== workflow.strategy) continue;
      const createdAtMs = Date.parse(run.createdAt || 0);
      if (Number.isFinite(createdAtMs) && createdAtMs + 1000 < (workflow.createdAtMs || 0)) continue;
      if (!newest || createdAtMs > newest.createdAtMs) newest = { runRoot, run, createdAtMs };
    }
    return newest;
  } catch (_) {
    return null;
  }
}

function unresolvedStages(match) {
  try {
    const contractsDir = path.join(match.runRoot, 'contracts');
    if (!fs.existsSync(contractsDir)) return ['contracts-missing'];
    const files = fs.readdirSync(contractsDir).filter(name => name.endsWith('.json'));
    if (files.length === 0) return ['contracts-empty'];
    const unresolved = [];
    for (const file of files) {
      const contract = readJson(path.join(contractsDir, file));
      if (!contract || contract.status !== 'pass') unresolved.push(contract && contract.stageId ? `${contract.stageId}:${contract.status || 'unknown'}` : file);
    }
    return unresolved;
  } catch (_) {
    return ['contract-read-failed'];
  }
}

function decide(payload) {
  try {
    // Claude marks the immediate retry after a blocked Stop. Avoid an infinite
    // hook loop; the PreToolUse workflow gate still prevents direct mutation.
    if (payload && payload.stop_hook_active) process.exit(0);

    const root = getWorkspaceRoot(payload);
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const sessionDir = getSessionDir(root, sessionId, payload);
    const workflow = readJson(path.join(sessionDir, 'workflow-run.json'));
    if (!workflow || workflow.state !== 'active') process.exit(0);
    if (workflow.disposition && workflow.disposition.status === 'escaped') process.exit(0);
    if (!String(workflow.strategy || '').startsWith('fable-')) process.exit(0);

    const match = findMatchingRun(root, workflow, sessionId);
    if (!match) {
      console.error(`[Workflow Completion Gate] Cannot complete: ${workflow.strategy} is active but no correlated Fable run exists for this session.`);
      console.error('Enter and resolve the selected workflow, or record an explicit evidence-backed workflow escape for genuinely uncovered scope.');
      process.exit(2);
    }

    const unresolved = unresolvedStages(match);
    if (unresolved.length > 0) {
      console.error(`[Workflow Completion Gate] Cannot complete: Fable run ${match.run.runId} still has unresolved stage contracts: ${unresolved.join(', ')}`);
      console.error('Resolve the stage checks/replan path before claiming completion.');
      process.exit(2);
    }

    process.exit(0);
  } catch (_) {
    // Compatibility evidence determines whether a host can enforce Stop.
    // A mechanism failure must not masquerade as proof of successful gating.
    process.exit(0);
  }
}

let input = '';
const timeout = setTimeout(() => decide(null), 250);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  let payload = null;
  try { payload = JSON.parse(input.trim()); } catch (_) { /* invalid payload */ }
  decide(payload);
});
process.stdin.on('error', () => {
  clearTimeout(timeout);
  decide(null);
});
