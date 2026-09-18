#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');
const { loadWorkflow, saveWorkflow, peekMutationProbe, settleMutationProbe } = require('./lib/workflow-runtime');
const { cwdOf, shellProbeKey, workspaceFingerprint, directMutationInWorkspace } = require('./lib/workflow-isolation');
const { observeTool } = require('./lib/telemetry');

// Commands that count as "verification ran" for the Stop gate
// (hooks/scripts/stop-gate.js). Recall over precision: under-blocking the
// gate is the correct failure direction, so a broad net is fine.
const VERIFY_COMMAND_RE = /\b(test|spec|jest|vitest|mocha|pytest|rspec|phpunit|tsc|eslint|lint|build|compile|verify|check)\b/i;

let inputData = '';
const timeout = setTimeout(() => {
  processState(null);
}, 200);

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const payload = JSON.parse(inputData.trim());
    processState(payload);
  } catch (err) {
    processState(null);
  }
});

function observeWorkspaceMutation(payload, root) {
  const toolName = payload && (payload.tool_name || payload.tool);
  if (toolName !== 'Bash' && toolName !== 'PowerShell' && toolName !== 'exec_command') return false;
  const context = loadWorkflow(payload);
  if (!context.workflow || context.workflow.state === 'deferred') return false;
  const cwd = cwdOf(payload, root);
  const probeKey = shellProbeKey(payload, cwd);
  if (!peekMutationProbe(context, probeKey)) return false;
  let after;
  try {
    after = workspaceFingerprint(cwd);
  } catch (error) {
    context.workflow.state = 'blocked';
    context.workflow.blockReason = 'mutation-observation-failed';
    saveWorkflow(context);
    const critical = new Error('cannot verify whether shell execution changed workspace content');
    critical.code = 'HARNESS_MUTATION_OBSERVATION';
    throw critical;
  }
  const result = settleMutationProbe(context, probeKey, after, toolName);
  return Boolean(result && result.changed);
}

function processState(payload) {
  let exitCodeForHook = 0;
  try {
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const root = getWorkspaceRoot(payload);
    const stateFile = path.join(getSessionDir(root, sessionId), 'handoff-state.json');

    // Merge into the existing state rather than replacing it, so the
    // failure/idle status and the Stop-gate milestones can coexist.
    let state = { status: 'idle', timestamp: new Date().toISOString() };
    if (fs.existsSync(stateFile)) {
      try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* keep default */ }
    }

    if (payload) {
      // Hook hosts nest tool output under tool_response, not at the top
      // level, and uses tool_name rather than tool. A numeric exit code
      // also isn't guaranteed to be present at all - only trust it when
      // it's actually a number; fall back to a stderr signal otherwise.
      const toolResponse = payload.tool_response || {};
      const stdout = toolResponse.stdout ?? payload.stdout ?? '';
      const stderr = toolResponse.stderr ?? payload.stderr ?? payload.error ?? '';
      const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
      const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;
      const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
      const hookEvent = payload.hook_event_name || payload.hookEventName || '';
      const isFailed = hookEvent === 'PostToolUseFailure' ||
        (exitCode !== undefined && exitCode !== 0) ||
        (exitCode === undefined && stderrSignal);
      const toolName = payload.tool_name || payload.tool || 'command';
      const observedMutation = observeWorkspaceMutation(payload, root);

      if (isFailed) {
        // Truncate output to avoid state bloat
        let output = (stderrSignal ? stderr : stdout) || payload.output || '';
        if (output.length > 500) {
          output = '...' + output.slice(-500);
        }

        state.status = 'failed';
        state.timestamp = new Date().toISOString();
        state.tool = toolName;
        state.exitCode = exitCode;
        state.errorSummary = output.trim();
      } else if (exitCode === 0 && state.status === 'failed') {
        // Clear failed state or mark as idle/resolved
        state.lastResolved = { tool: state.tool, timestamp: state.timestamp };
        state.status = 'idle';
        state.timestamp = new Date().toISOString();
        delete state.exitCode;
        delete state.errorSummary;
      }

      // Milestones for the Stop gate: when did the last mutation happen, and
      // has any verification-ish command succeeded since. Direct-tool edits
      // outside the workspace advance neither milestone (#165).
      const isDirectTool = toolName === 'Edit' || toolName === 'Write' || toolName === 'apply_patch';
      if ((isDirectTool && directMutationInWorkspace(payload, cwdOf(payload, root), root)) || observedMutation) {
        state.lastEditAt = Date.now();
      }
      if ((toolName === 'Bash' || toolName === 'PowerShell') && !isFailed) {
        const command = (payload.tool_input && payload.tool_input.command) || '';
        if (VERIFY_COMMAND_RE.test(command)) {
          state.lastVerifyAt = Date.now();
          state.lastVerifyExitCode = exitCode ?? null;
        }
      }

      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      // Reuse this already-running post-tool hook instead of spawning another
      // process for every tool solely for telemetry. The observer is fail-open
      // and stores no command/args/output content.
      observeTool(payload);
    } else {
      // No standard input payload, or invalid JSON. Just maintain a heartbeat timestamp
      if (!fs.existsSync(stateFile)) {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }
  } catch (err) {
    if (err && (err.code === 'HARNESS_MUTATION_OBSERVATION' || err.code === 'HARNESS_WORKFLOW_BUDGET')) {
      console.error('[State Persist] ' + err.message);
      exitCodeForHook = 2;
    }
    // Non-critical persistence/telemetry failures remain fail-open.
  }
  process.exit(exitCodeForHook);
}
