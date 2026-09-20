#!/usr/bin/env node
'use strict';
const path = require('path');
const { readJson } = require('./lib/fable-contracts');
const { loadWorkflow, saveWorkflow, matchingRun, unresolvedStages, readHookInput } = require('./lib/workflow-runtime');
function warn(message) { console.error('[Workflow Reminder] ' + message); }
function decide(payload) {
  if (!payload) return;
  try {
    const context = loadWorkflow(payload);
    const { workflow, sessionDir } = context;
    if (!workflow || workflow.state === 'deferred') return;
    let unresolved = [];
    if (String(workflow.strategy || '').startsWith('fable-')) {
      const match = matchingRun(context);
      unresolved = match ? unresolvedStages(match, workflow) : ['correlated-run-missing'];
    } else {
      const handoff = readJson(path.join(sessionDir, 'handoff-state.json'));
      const lastEdit = Math.max(workflow.lastMutationAt || 0, handoff?.lastEditAt || 0);
      if (lastEdit && (handoff?.lastVerifyAt || 0) < lastEdit) unresolved = ['verification-after-edit-missing'];
    }
    if (workflow.state === 'blocked') warn('Workflow is marked BLOCKED; report or revisit the recorded blocker, but Harness will not trap the session.');
    if (unresolved.length) {
      workflow.unresolved = unresolved;
      saveWorkflow(context);
      warn('Unresolved workflow evidence: ' + unresolved.join(', ') + '. Verify/review before claiming completion.');
      return;
    }
    workflow.state = 'satisfied';
    workflow.resolvedAt = new Date().toISOString();
    workflow.unresolved = [];
    saveWorkflow(context);
  } catch (error) { warn(error && error.message ? error.message : String(error)); }
}
readHookInput(decide);
