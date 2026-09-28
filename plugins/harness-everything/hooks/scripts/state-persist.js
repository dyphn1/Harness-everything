#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');
const { cwdOf, classifyShell, isVerificationShell, directMutationInWorkspace } = require('./lib/workflow-isolation');
const { observeTool } = require('./lib/telemetry');
let inputData = '';
const timeout = setTimeout(() => processState(null), 200);
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => { clearTimeout(timeout); try { processState(JSON.parse(inputData.trim())); } catch (_) { processState(null); } });
function processState(payload) {
  try {
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const root = getWorkspaceRoot(payload);
    const stateFile = path.join(getSessionDir(root, sessionId), 'handoff-state.json');
    let state = { status: 'idle', timestamp: new Date().toISOString() };
    if (fs.existsSync(stateFile)) { try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {} }
    if (!payload) {
      if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      process.exit(0);
    }
    const toolResponse = payload.tool_response || {};
    const stdout = toolResponse.stdout ?? payload.stdout ?? '';
    const stderr = toolResponse.stderr ?? payload.stderr ?? payload.error ?? '';
    const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
    const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;
    const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
    const hookEvent = payload.hook_event_name || payload.hookEventName || '';
    const isSuccessEvent = hookEvent === 'PostToolUse';
    const isFailed = hookEvent === 'PostToolUseFailure' || (exitCode !== undefined && exitCode !== 0) || (!isSuccessEvent && exitCode === undefined && stderrSignal);
    const toolName = payload.tool_name || payload.tool || 'command';
    if (isFailed) {
      let output = (stderrSignal ? stderr : stdout) || payload.output || '';
      if (output.length > 500) output = '...' + output.slice(-500);
      state.status = 'failed'; state.timestamp = new Date().toISOString(); state.tool = toolName; state.exitCode = exitCode; state.errorSummary = output.trim();
    } else if (state.status === 'failed') {
      state.lastResolved = { tool: state.tool, timestamp: state.timestamp }; state.status = 'idle'; state.timestamp = new Date().toISOString(); delete state.exitCode; delete state.errorSummary;
    }
    const isDirectTool = toolName === 'Edit' || toolName === 'Write' || toolName === 'apply_patch';
    if (isDirectTool && directMutationInWorkspace(payload, cwdOf(payload, root), root)) state.lastEditAt = Date.now();
    const isShell = toolName === 'Bash' || toolName === 'PowerShell' || toolName === 'exec_command';
    const command = (payload.tool_input && payload.tool_input.command) || '';
    if (isShell) {
      const commandClass = classifyShell(command);
      if (commandClass !== 'read-only' && commandClass !== 'worktree-setup') state.lastEditAt = Date.now();
      if (!isFailed && isVerificationShell(command, { cwd: cwdOf(payload, root), root })) { state.lastVerifyAt = Date.now(); state.lastVerifyExitCode = exitCode ?? null; }
    }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    observeTool(payload);
  } catch (_) {}
  process.exit(0);
}
