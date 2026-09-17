#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, getStateRoot } = require('./lib/harness-state');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function hasMatchingFableRun(root, workflow, sessionId) {
  try {
    const runsRoot = path.join(getStateRoot(root), 'fable-runs');
    if (!fs.existsSync(runsRoot)) return false;
    for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const run = readJson(path.join(runsRoot, entry.name, 'run.json'));
      if (!run) continue;
      if (sessionId && run.sessionId && run.sessionId !== sessionId) continue;
      if (run.strategy !== workflow.strategy) continue;
      const createdAtMs = Date.parse(run.createdAt || 0);
      if (Number.isFinite(createdAtMs) && createdAtMs + 1000 < (workflow.createdAtMs || 0)) continue;
      return true;
    }
  } catch (_) { /* fail open below */ }
  return false;
}

function decide(payload) {
  try {
    const toolName = payload && (payload.tool_name || payload.tool);
    if (!['Edit', 'Write', 'apply_patch'].includes(toolName)) process.exit(0);

    const root = getWorkspaceRoot(payload);
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const workflowFile = path.join(getSessionDir(root, sessionId, payload), 'workflow-run.json');
    const workflow = readJson(workflowFile);
    if (!workflow || workflow.state !== 'active') process.exit(0);
    if (workflow.disposition && workflow.disposition.status === 'escaped') process.exit(0);
    if (!String(workflow.strategy || '').startsWith('fable-')) process.exit(0);
    if (hasMatchingFableRun(root, workflow, sessionId)) process.exit(0);

    console.error(`[Workflow Gate] ${workflow.strategy} is the active mandatory workflow, but no correlated Fable run has been started for this session.`);
    console.error('Direct artifact mutation is blocked until the selected workflow is entered. Start the Fable run through the orchestrator, or use the explicit workflow escape only when the selected topology genuinely cannot cover part of the task.');
    process.exit(2);
  } catch (_) {
    // Host/mechanism failures must not be misrepresented as successful enforcement.
    // Fail open here; compatibility evidence owns whether this hook is hard on a host.
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
