#!/usr/bin/env node
'use strict';
const path = require('path');
const { readJson } = require('./lib/fable-contracts');
const { loadWorkflow, saveWorkflow, matchingRun, unresolvedStages, readHookInput } = require('./lib/workflow-runtime');\nconst { unresolvedObligations } = require('./lib/workflow-obligations');
function warn(message) { console.error('[Workflow Reminder] ' + message); }
function decide(payload) {
  if (!payload) return;
  try {
    const context = loadWorkflow(payload);
    const { workflow, sessionDir } = context;
    if (!workflow || workflow.state === 'deferred') return;
    const handoff = readJson(path.join(sessionDir, 'handoff-state.json'));
    let unresolved = [];
    if (String(workflow.strategy || '').startsWith('fable-')) {
      const match = matchingRun(context);
      unresolved = match ? unresolvedStages(match, workflow, handoff?.lastEditAt || 0) : ['correlated-run-missing'];
    } else {
      unresolved = unresolvedObligations(context);
      const lastEdit = Math.max(workflow.lastMutationAt || 0, handoff?.lastEditAt || 0);
      if (lastEdit && (handoff?.lastVerifyAt || 0) < lastEdit) unresolved.push('verification-after-edit-missing');
    }
    const wasBlocked = workflow.state === 'blocked';
    if (wasBlocked) warn('Workflow is marked BLOCKED; report or revisit the recorded blocker, but Harness will not trap the session.');
    if (unresolved.length) {
      workflow.unresolved = unresolved;
      saveWorkflow(context);
      warn('Unresolved workflow evidence: ' + unresolved.join(', ') + '. Verify/review before claiming completion.');
      return;
    }
    if (wasBlocked) return;
    workflow.state = 'satisfied';
    workflow.resolvedAt = new Date().toISOString();
    workflow.unresolved = [];
    saveWorkflow(context);
  } catch (error) { warn(error && error.message ? error.message : String(error)); }
}
readHookInput(decide);
