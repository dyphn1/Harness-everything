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
    context.activeHost = payload && typeof payload.host_id === 'string' ? payload.host_id : undefined;
    const { workflow, sessionDir } = context;
    if (!workflow || workflow.state === 'deferred') return;
    const handoffFile = path.join(sessionDir, 'handoff-state.json');
    let handoff = readJson(handoffFile);
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
      if (!unresolved.length) {
        require('./lib/doc-reconciliation-pilot').assess(context, null);
      }
      const match = matchingRun(context);
      unresolved.push(...(match ? unresolvedStages(match, workflow, handoff?.lastEditAt || 0) : ['correlated-run-missing']));
    } else {
      required(() => unresolvedObligations(context));
      // Assessment can withdraw stale document verification; read the current aggregate afterward.
      handoff = readJson(handoffFile);
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
        // PR #351 follow-up (unwritable session store): persisting the pending downgrade is
        // best-effort. A failing saveWorkflow() must not swallow the decision or leak exception
        // text: record the withhold-persist-failed diagnostic on the shared context diagnostics
        // (also when the earlier obligations write already failed) and still emit the reminder
        // below. Stop stays non-blocking: exit 0, no retry loop, no lock.
        // Scope of the recovery (PR #351 re-review): the local recovery and the
        // withhold-persist-failed diagnostic apply only when this Stop run made an actual ON,
        // supported, withheld pilot decision (`withholdPilotVerification` sets the transient
        // per-run marker on the context). On switch-OFF, Fable and persisted-untyped paths the
        // marker is never set, so the error is rethrown and reaches Stop's outer handler exactly
        // as the pre-S1 legacy reference: same stderr, same exit 0, no pilot diagnostic.
        try {
          saveWorkflow(context);
        } catch (error) {
          if (context.docReconciliationWithheldRun !== true) throw error;
          if (!Array.isArray(context.workflow.docReconciliationDiagnostics)) {
            context.workflow.docReconciliationDiagnostics = [];
          }
          if (!context.workflow.docReconciliationDiagnostics.includes('withhold-persist-failed')) {
            context.workflow.docReconciliationDiagnostics.push('withhold-persist-failed');
          }
          warn('Pending-workflow persistence failed (withhold-persist-failed); the unresolved evidence below is still binding.');
        }
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

if (require.main === module) readHookInput(decide);

module.exports = { decide };
