#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const { loadWorkflow, saveWorkflow, isMajorWorkflow, matchingRun, readHookInput, WORKFLOW_CONTROLLER_COMMANDS } = require('./lib/workflow-runtime');
const { key, classifyShell, cwdOf, commandOf, mutationPaths, directMutationInWorkspace, linkedWorktree, assertTargets, assertShellScope } = require('./lib/workflow-isolation');
const DIRECT = new Set(['Edit', 'Write', 'apply_patch']);
const SHELL = new Set(['Bash', 'PowerShell', 'exec_command']);
function warn(message) { console.error('[Workflow Reminder] ' + message); }
function isController(command, cwd) {
  if (/[;&|\x60\r\n<>$(){}]/.test(command)) return false;
  const match = command.match(/^node\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([A-Za-z][A-Za-z0-9-]*)\b/);
  return Boolean(match && WORKFLOW_CONTROLLER_COMMANDS.has(match[4]) &&
    key(path.resolve(cwd, match[1] || match[2] || match[3])) === key(path.join(__dirname, 'workflow-disposition.js')));
}
function decide(payload) {
  if (!payload) return;
  try {
    const tool = payload.tool_name || payload.tool;
    if (!DIRECT.has(tool) && !SHELL.has(tool)) return;
    const context = loadWorkflow(payload);
    const { workflow, root, sessionDir } = context;
    if (!workflow || workflow.state === 'deferred') return;
    const cwd = cwdOf(payload, root), command = commandOf(payload);
    const commandClass = SHELL.has(tool) ? classifyShell(command) : 'direct-mutation';
    if (SHELL.has(tool) && isController(command, cwd)) return;
    if (commandClass === 'read-only' || commandClass === 'worktree-setup') return;
    const targets = DIRECT.has(tool) ? mutationPaths(payload) : [];
    const spec = path.join(sessionDir, 'workflow-stages.json');
    const specStat = fs.existsSync(spec) ? fs.lstatSync(spec) : null;
    if ((!specStat || (specStat.isFile() && !specStat.isSymbolicLink() && specStat.nlink === 1)) &&
        targets.length && targets.every(target => key(path.resolve(cwd, target)) === key(spec))) return;
    if (['blocked', 'failed'].includes(workflow.state)) warn('Workflow is marked ' + workflow.state.toUpperCase() + '; review the recorded reason before continuing.');
    if (workflow.state === 'satisfied') warn('Workflow was already marked satisfied; confirm this mutation belongs to the current task.');
    if (String(workflow.strategy || '').startsWith('fable-') && !matchingRun(context)) warn('Selected Fable workflow has no correlated run; consider creating/updating the stage map before broad changes.');
    if (isMajorWorkflow(workflow)) {
      const isolatedRoot = linkedWorktree(cwd, root);
      if (!isolatedRoot) warn('Tier-3/Fable isolation disposition is a semantic MUST before broad mutation: enter a linked Git worktree or record an explicit degraded fallback. This reminder does not hard-block.');
      else {
        try { if (DIRECT.has(tool)) assertTargets(payload, cwd, isolatedRoot); else assertShellScope(command, cwd, isolatedRoot); }
        catch (error) { warn(error.message); }
      }
    }
    if (DIRECT.has(tool) && directMutationInWorkspace(payload, cwd, root)) {
      workflow.lastMutationAt = Date.now();
      saveWorkflow(context);
    }
  } catch (error) { warn(error && error.message ? error.message : String(error)); }
}
readHookInput(decide);
