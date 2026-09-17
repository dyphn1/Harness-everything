#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getWorkspaceRoot, getSessionDir, getStateRoot } = require('./lib/harness-state');

const DIRECT_MUTATION_TOOLS = new Set(['Edit', 'Write', 'apply_patch']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function toolInput(payload) {
  const input = payload && (payload.tool_input || payload.toolInput || payload.input);
  return input && typeof input === 'object' ? input : {};
}

function commandFromPayload(payload) {
  const input = toolInput(payload);
  return String(input.command || input.script || input.cmd || '');
}

function toolCwd(payload, root) {
  const input = toolInput(payload);
  return input.cwd || input.working_directory || input.workingDirectory ||
    (payload && (payload.cwd || payload.working_directory || payload.workingDirectory)) || root;
}

function normalizeGitPath(cwd, value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return path.normalize(path.isAbsolute(text) ? text : path.resolve(cwd, text));
}

function gitRevParse(cwd, arg) {
  const result = spawnSync('git', ['rev-parse', arg], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function isLinkedWorktree(cwd) {
  try {
    const gitDir = normalizeGitPath(cwd, gitRevParse(cwd, '--git-dir'));
    const commonDir = normalizeGitPath(cwd, gitRevParse(cwd, '--git-common-dir'));
    if (!gitDir || !commonDir) return false;
    const normalizeCase = value => process.platform === 'win32' ? value.toLowerCase() : value;
    return normalizeCase(gitDir) !== normalizeCase(commonDir);
  } catch (_) {
    return false;
  }
}

function classifyShellBeforeIsolation(command) {
  const text = String(command || '').trim();
  if (!text) return 'mutation-or-unknown';

  // Never accept a chained command as read-only or setup-safe: a harmless
  // prefix such as `git status && rm -rf ...` must not bypass isolation.
  if (/[;&|`\r\n]/.test(text)) return 'mutation-or-unknown';

  const worktreeSetup = /^git\s+worktree\s+add(?:\s+.+)?$/i;
  if (worktreeSetup.test(text)) return 'worktree-setup';

  const readOnly = [
    /^git\s+status(?:\s+.*)?$/i,
    /^git\s+rev-parse(?:\s+.*)?$/i,
    /^git\s+diff(?:\s+.*)?$/i,
    /^git\s+log(?:\s+.*)?$/i,
    /^git\s+show(?:\s+.*)?$/i,
    /^git\s+ls-files(?:\s+.*)?$/i,
    /^git\s+check-ignore(?:\s+.*)?$/i,
    /^git\s+branch\s+--show-current$/i,
    /^git\s+worktree\s+list(?:\s+.*)?$/i,
    /^(?:pwd|ls|dir)(?:\s+.*)?$/i,
    /^(?:cat|type|head|tail|wc|stat)(?:\s+.*)?$/i,
    /^(?:grep|rg|find|fd)(?:\s+.*)?$/i,
    /^(?:Get-Location|Get-ChildItem|Get-Content|Select-String|Test-Path)(?:\s+.*)?$/i,
  ];
  return readOnly.some(regex => regex.test(text)) ? 'read-only' : 'mutation-or-unknown';
}

function isMajorWorkflow(workflow) {
  return Boolean(workflow && (workflow.tier === 'tier3' || String(workflow.strategy || '').startsWith('fable-')));
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

function blockForIsolation(workflow) {
  console.error(`[Workflow Gate] ${workflow.strategy || workflow.tier || 'major workflow'} requires Git worktree isolation before source/artifact mutation.`);
  console.error('Mutation in the primary working tree is blocked. Enter an existing linked worktree or create one with using-git-worktrees. If isolation cannot be established, remain BLOCKED; do not fall back to in-place mutation.');
  process.exit(2);
}

function decide(payload) {
  try {
    const toolName = payload && (payload.tool_name || payload.tool);
    if (!DIRECT_MUTATION_TOOLS.has(toolName) && !SHELL_TOOLS.has(toolName)) process.exit(0);

    const root = getWorkspaceRoot(payload);
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const workflowFile = path.join(getSessionDir(root, sessionId, payload), 'workflow-run.json');
    const workflow = readJson(workflowFile);
    if (!workflow || workflow.state !== 'active') process.exit(0);

    const commandClass = SHELL_TOOLS.has(toolName)
      ? classifyShellBeforeIsolation(commandFromPayload(payload))
      : 'direct-mutation';
    const mutationIntent = DIRECT_MUTATION_TOOLS.has(toolName) || commandClass === 'mutation-or-unknown';

    if (isMajorWorkflow(workflow)) {
      const cwd = toolCwd(payload, root);
      const isolated = isLinkedWorktree(cwd);
      if (!isolated) {
        if (commandClass === 'read-only' || commandClass === 'worktree-setup') process.exit(0);
        if (mutationIntent) blockForIsolation(workflow);
      }
    }

    // Workflow escape can relax topology execution only after the independent
    // worktree safety invariant has been satisfied for major mutation.
    if (workflow.disposition && workflow.disposition.status === 'escaped') process.exit(0);
    if (!String(workflow.strategy || '').startsWith('fable-')) process.exit(0);
    if (!mutationIntent) process.exit(0);
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
