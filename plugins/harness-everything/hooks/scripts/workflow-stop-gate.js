#!/usr/bin/env node
'use strict';
const path = require('path');
const { readJson } = require('./lib/fable-contracts');
const { loadWorkflow, saveWorkflow, matchingRun, unresolvedStages, readHookInput } = require('./lib/workflow-runtime');

const REGISTRY_UNAVAILABLE = 'step-type-registry-unavailable';
const STEP_TYPE_REGISTRY_UNAVAILABLE = 'STEP_TYPE_REGISTRY_UNAVAILABLE';

function warn(message) { console.error('[Workflow Reminder] ' + message); }

function decide(payload) {
  if (!payload) return;
  try {
    const { planningUnresolved, unresolvedObligations } = require('./lib/workflow-obligations');
    const context = loadWorkflow(payload);
    const { workflow, sessionDir } = context;
    if (!workflow || workflow.state === 'deferred') return;
    const handoff = readJson(path.join(sessionDir, 'handoff-state.json'));
    const unresolved = [];
    const diagnostics = [];
    let requiredFault = false;

    // Only a validation that actually reads the registry can fail here. It records the
    // semantic diagnostic and the unresolved token itself; other checks keep running.
    const required = check => {
      try {
        unresolved.push(...check());
      } catch (error) {
        if (error.code !== STEP_TYPE_REGISTRY_UNAVAILABLE) throw error;
        diagnostics.push(error.message);
        unresolved.push(REGISTRY_UNAVAILABLE);
        requiredFault = true;
      }
    };

    required(() => planningUnresolved(context));
    if (String(workflow.strategy || '').startsWith('fable-')) {
      if (!unresolved.length) require('./lib/doc-reconciliation-pilot').assess(context, null);
      const match = matchingRun(context);
      unresolved.push(...(match ? unresolvedStages(match, workflow, handoff?.lastEditAt || 0) : ['correlated-run-missing']));
    } else {
      required(() => unresolvedObligations(context));
      const lastEdit = Math.max(workflow.lastMutationAt || 0, handoff?.lastEditAt || 0);
      if (lastEdit && (handoff?.lastVerifyAt || 0) < lastEdit) unresolved.push('verification-after-edit-missing');
    }

    const pending = [...new Set(unresolved)];
    const wasBlocked = workflow.state === 'blocked';
    if (wasBlocked) warn('Workflow is marked BLOCKED; report or revisit the recorded blocker, but Harness will not trap the session.');
    [...new Set(diagnostics)].forEach(message => warn(message));
    if (pending.length) {
      // A failed required validation leaves the workflow file as recorded; it is never marked satisfied.
      if (!requiredFault) {
        workflow.unresolved = pending;
        saveWorkflow(context);
      }
      warn('Unresolved workflow evidence: ' + pending.join(', ') + '. Resolve/verify before claiming completion.');
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
