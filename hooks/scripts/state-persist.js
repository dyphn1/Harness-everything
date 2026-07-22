#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

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

function processState(payload) {
  try {
    const sessionId = payload && payload.session_id;
    const stateFile = path.join(getSessionDir(getWorkspaceRoot(), sessionId), 'handoff-state.json');

    // Merge into the existing state rather than replacing it, so the
    // failure/idle status and the Stop-gate milestones can coexist.
    let state = { status: 'idle', timestamp: new Date().toISOString() };
    if (fs.existsSync(stateFile)) {
      try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* keep default */ }
    }

    if (payload) {
      // Claude Code nests tool output under tool_response, not at the top
      // level, and uses tool_name rather than tool. A numeric exit code
      // also isn't guaranteed to be present at all - only trust it when
      // it's actually a number; fall back to a stderr signal otherwise.
      const toolResponse = payload.tool_response || {};
      const stdout = toolResponse.stdout ?? payload.stdout ?? '';
      const stderr = toolResponse.stderr ?? payload.stderr ?? '';
      const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
      const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;
      const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
      const isFailed = (exitCode !== undefined && exitCode !== 0) || (exitCode === undefined && stderrSignal);
      const toolName = payload.tool_name || payload.tool || 'command';

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
      // has any verification-ish command succeeded since.
      if (toolName === 'Edit' || toolName === 'Write') {
        state.lastEditAt = Date.now();
      } else if ((toolName === 'Bash' || toolName === 'PowerShell') && !isFailed) {
        const command = (payload.tool_input && payload.tool_input.command) || '';
        if (VERIFY_COMMAND_RE.test(command)) {
          state.lastVerifyAt = Date.now();
        }
      }

      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    } else {
      // No standard input payload, or invalid JSON. Just maintain a heartbeat timestamp
      if (!fs.existsSync(stateFile)) {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }
  } catch (err) {
    // Fail silently in hooks
  }
  process.exit(0);
}
