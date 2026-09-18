#!/usr/bin/env node
'use strict';

const {
  loadWorkflow,
  saveWorkflow,
  takeMutationProbe,
  recordBudgetEvent,
  readHookInput,
} = require('./lib/workflow-runtime');
const { cwdOf, shellProbeKey, workspaceFingerprint } = require('./lib/workflow-isolation');

const SHELL = new Set(['Bash', 'PowerShell', 'exec_command']);

function observe(payload) {
  if (!payload) return;
  const tool = payload.tool_name || payload.tool;
  if (!SHELL.has(tool)) return;

  const context = loadWorkflow(payload);
  const { workflow, root } = context;
  if (!workflow || workflow.state === 'deferred') return;

  const cwd = cwdOf(payload, root);
  const probeKey = shellProbeKey(payload, cwd);
  const probe = takeMutationProbe(context, probeKey);
  if (!probe) return;

  let after;
  try {
    after = workspaceFingerprint(cwd);
  } catch (error) {
    workflow.state = 'blocked';
    workflow.blockReason = 'mutation-observation-failed';
    saveWorkflow(context);
    throw new Error('cannot verify whether shell execution changed workspace content');
  }

  if (after !== probe.fingerprint) {
    if (probe.reserveIteration && workflow.strategy === 'iterative-single') {
      recordBudgetEvent(context, 'iteration', { evidence: tool + ':observed-workspace-mutation' });
    }
    workflow.lastMutationAt = Date.now();
  }

  saveWorkflow(context);
}

readHookInput(observe);
