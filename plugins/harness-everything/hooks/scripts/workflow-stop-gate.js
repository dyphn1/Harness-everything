#!/usr/bin/env node
'use strict';

const path = require('path');
const { readJson } = require('./lib/fable-contracts');
const { loadWorkflow, saveWorkflow, matchingRun, unresolvedStages, readHookInput } = require('./lib/workflow-runtime');

function decide(payload) {
  if (!payload) return;
  const context = loadWorkflow(payload);
  const { workflow, sessionDir } = context;
  if (!workflow || ['deferred', 'satisfied'].includes(workflow.state)) return;
  if (workflow.state === 'blocked') {
    console.error('[Workflow Completion Gate] BLOCKED: report the unresolved work; completion has not been verified.');
    return;
  }
  let unresolved = [];
  if (String(workflow.strategy || '').startsWith('fable-')) {
    const match = matchingRun(context);
    unresolved = match ? unresolvedStages(match, workflow) : ['correlated-run-missing'];
  } else {
    const handoff = readJson(path.join(sessionDir, 'handoff-state.json'));
    const lastEdit = Math.max(workflow.lastMutationAt || 0, handoff?.lastEditAt || 0);
    // state-persist.js only ever records lastVerifyAt/lastVerifyExitCode from
    // its `!isFailed` branch, so reaching this timestamp already proves the
    // command succeeded. Do not additionally require lastVerifyExitCode===0:
    // hosts are not guaranteed to report a numeric exit code at all (some
    // PostToolUse payloads omit it entirely), in which case state-persist.js
    // correctly records success with lastVerifyExitCode: null, and requiring
    // a literal 0 here would make this gate permanently unresolvable on that
    // host after any edit.
    if (lastEdit && (handoff?.lastVerifyAt || 0) < lastEdit) unresolved = ['verification-after-edit-missing'];
  }
  if (unresolved.length) {
    workflow.unresolved = unresolved;
    if (payload.stop_hook_active) {
      // Do not loop forever or pretend the retry satisfied the contract.
      workflow.state = 'blocked';
      workflow.blockReason = 'unresolved-stop-retry';
      saveWorkflow(context);
      console.error('[Workflow Completion Gate] BLOCKED: ' + unresolved.join(', ') + '. Report the blocker; this is not completion.');
      return;
    }
    saveWorkflow(context);
    throw new Error('Cannot complete: unresolved workflow obligations: ' + unresolved.join(', '));
  }
  workflow.state = 'satisfied';
  workflow.resolvedAt = new Date().toISOString();
  workflow.unresolved = [];
  saveWorkflow(context);
}
readHookInput(decide);
