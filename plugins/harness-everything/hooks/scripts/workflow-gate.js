#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { loadWorkflow, saveWorkflow, isMajorWorkflow, matchingRun, registerMutationProbe, recordBudgetEvent, readHookInput, WORKFLOW_CONTROLLER_COMMANDS } = require('./lib/workflow-runtime');
const { key, classifyShell, isVerificationShell, workspaceFingerprint, shellProbeKey, cwdOf, commandOf, mutationPaths, directMutationInWorkspace, linkedWorktree, assertTargets, assertShellScope } = require('./lib/workflow-isolation');

const DIRECT = new Set(['Edit', 'Write', 'apply_patch']);
const SHELL = new Set(['Bash', 'PowerShell', 'exec_command']);

function isController(command, cwd) {
  // One trusted local executable, literal arguments, no shell evaluation.
  if (/[;&|`\r\n<>$(){}]/.test(command)) return false;
  const match = command.match(/^node\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([A-Za-z][A-Za-z0-9-]*)\b/);
  return Boolean(match && WORKFLOW_CONTROLLER_COMMANDS.has(match[4]) &&
    key(path.resolve(cwd, match[1] || match[2] || match[3])) === key(path.join(__dirname, 'workflow-disposition.js')));
}

function decide(payload) {
  if (!payload) return;
  const tool = payload.tool_name || payload.tool;
  if (!DIRECT.has(tool) && !SHELL.has(tool)) return;
  const context = loadWorkflow(payload);
  const { workflow, root, sessionDir } = context;
  if (!workflow || workflow.state === 'deferred') return;
  const cwd = cwdOf(payload, root);
  const command = commandOf(payload);
  const commandClass = SHELL.has(tool) ? classifyShell(command) : 'direct-mutation';
  if (SHELL.has(tool) && isController(command, cwd)) return;
  if (commandClass === 'read-only' || commandClass === 'worktree-setup') return;
  // Only the stage specification is allowed before run entry. Other runtime
  // state, including workflow-run.json, cannot use this bootstrap exception.
  const targets = DIRECT.has(tool) ? mutationPaths(payload) : [];
  const spec = path.join(sessionDir, 'workflow-stages.json');
  const specStat = fs.existsSync(spec) ? fs.lstatSync(spec) : null;
  if ((!specStat || (specStat.isFile() && !specStat.isSymbolicLink() && specStat.nlink === 1)) &&
      targets.length && targets.every(target => key(path.resolve(cwd, target)) === key(spec))) return;
  if (['blocked', 'failed'].includes(workflow.state)) throw new Error('workflow is BLOCKED; replan through the controller before mutation');
  if (isMajorWorkflow(workflow)) {
    const isolatedRoot = linkedWorktree(cwd, root);
    if (!isolatedRoot) throw new Error('Git worktree isolation is required before mutation. Enter a linked worktree; unavailable isolation means BLOCKED, never in-place fallback.');
    if (DIRECT.has(tool)) assertTargets(payload, cwd, isolatedRoot);
    else assertShellScope(command, cwd, isolatedRoot);
  }
  if (workflow.state === 'satisfied') throw new Error('workflow is already satisfied; submit a new task before further mutation');
  if (String(workflow.strategy || '').startsWith('fable-') && !matchingRun(context)) {
    throw new Error('selected Fable workflow has no correlated run. Write workflow-stages.json at the displayed session path, then use workflow-disposition.js start.');
  }
  if (DIRECT.has(tool)) {
    // Bookkeeping outside the workspace (scratchpad, memory files, temp
    // notes) is not a workspace mutation: it consumes no Tier-2 iteration
    // and advances no mutation milestone (#165).
    if (!directMutationInWorkspace(payload, cwd, root)) return;
    if (workflow.strategy === 'iterative-single') {
      recordBudgetEvent(context, 'iteration', { evidence: `${tool}:direct-mutation` });
    }
    workflow.lastMutationAt = Date.now();
    saveWorkflow(context);
    return;
  }

  // Shell safety and shell mutation accounting are intentionally separate.
  // `untrusted` means "not proven read-only", not "a mutation occurred".
  // Capture an opaque pre-execution workspace fingerprint when possible. A
  // non-major workflow may run outside Git, where mutation observation is an
  // accounting aid rather than an isolation boundary; degrade conservatively
  // instead of blocking the user's command (#162).
  let fingerprint;
  try {
    fingerprint = workspaceFingerprint(cwd);
  } catch (error) {
    const fingerprintLimited = error && error.code === 'HARNESS_FINGERPRINT_LIMIT';
    if (isMajorWorkflow(workflow) && !fingerprintLimited) throw error;
    const evidence = fingerprintLimited ? 'shell:fingerprint-limit' : 'shell:unobservable-workspace';
    if (workflow.strategy === 'iterative-single') {
      recordBudgetEvent(context, 'iteration', { evidence });
    }
    workflow.lastMutationAt = Date.now();
    saveWorkflow(context);
    return;
  }
  const probeKey = shellProbeKey(payload, cwd);
  const iterative = workflow.strategy === 'iterative-single';
  registerMutationProbe(context, probeKey, fingerprint, iterative, cwd, {
    countIteration: iterative,
    allowAtLimit: iterative && isVerificationShell(command),
  });
}

readHookInput(decide);
