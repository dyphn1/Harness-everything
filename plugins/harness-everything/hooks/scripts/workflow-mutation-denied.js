#!/usr/bin/env node
'use strict';

const { loadWorkflow, discardMutationProbe, readHookInput } = require('./lib/workflow-runtime');
const { cwdOf, shellProbeKey } = require('./lib/workflow-isolation');

function discardDenied(payload) {
  if (!payload) return;
  const tool = payload.tool_name || payload.tool;
  if (tool !== 'Bash' && tool !== 'PowerShell' && tool !== 'exec_command') return;
  const context = loadWorkflow(payload);
  if (!context.workflow || context.workflow.state === 'deferred') return;
  const cwd = cwdOf(payload, context.root);
  discardMutationProbe(context, shellProbeKey(payload, cwd));
}

readHookInput(discardDenied);
