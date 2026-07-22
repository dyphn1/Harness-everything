#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

// PostToolUse hooks in Claude Code typically receive the tool output via stdin
let inputData = '';

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    // Claude Code's documented PostToolUse payload nests tool output under
    // tool_response rather than at the top level, and does not guarantee a
    // numeric exit code field. Treating a missing/unknown exit code as a
    // failure (the old `exitCode !== 0` check) flags every successful call
    // as an error. Only count a call as a failure when we have positive
    // evidence of one.
    const toolResponse = payload.tool_response || {};
    const stdout = toolResponse.stdout ?? payload.stdout ?? '';
    const stderr = toolResponse.stderr ?? payload.stderr ?? '';
    const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
    const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;

    const explicitFailure = exitCode !== undefined && exitCode !== 0;
    const explicitSuccess = exitCode === 0;
    const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
    // Without an exit code, bare stderr is not enough evidence: plenty of
    // tools chat on stderr while succeeding (git, npm warnings, progress
    // bars), and three identical warnings must not trip the breaker. Require
    // the text to actually look like a failure.
    const looksLikeError = /\b(error|fail|failed|failure|exception|fatal|panic|traceback|denied|refused|cannot|unable)\b/i.test(stderr);
    const isFailure = explicitFailure || (exitCode === undefined && stderrSignal && looksLikeError);
    const errorText = (stderrSignal ? stderr : stdout) || '';

    const stateFile = path.join(getSessionDir(getWorkspaceRoot(), payload.session_id), 'rule-of-3-state.json');

    let state = { count: 0, lastHash: null, zoomOutResolved: false, zoomOutCycles: 0, lastFailureAt: 0 };
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    if (isFailure && errorText) {
      // Hash the tail of the error to identify identical loops. Normalize
      // first: timestamps, line numbers, addresses and counters vary between
      // otherwise-identical failures, and an ever-changing hash would hide a
      // genuine loop from the breaker.
      const normalized = errorText.slice(-400)
        .toLowerCase()
        .replace(/0x[0-9a-f]+/g, '#')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
      const hash = crypto.createHash('md5').update(normalized.slice(-200)).digest('hex');

      if (state.lastHash === hash) {
        state.count += 1;
      } else {
        state.count = 1;
        state.lastHash = hash;
        // New signature = new problem: the zoom-out cycle budget starts over.
        state.zoomOutCycles = 0;
      }
      // Any fresh failure re-arms the breaker. Without this, a signature that
      // failed again after a success (or after a zoom-out release) would keep
      // zoomOutResolved=true and the breaker could never trip on it again.
      state.zoomOutResolved = false;
      // rule-of-3.js only honors a zoom-out report written AFTER this moment,
      // so a stale report can't unlock a later trip.
      state.lastFailureAt = Date.now();

      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    } else if (explicitSuccess) {
      // Only reset on a *confirmed* zero exit code, not merely "not a failure".
      if (state.count > 0 || state.zoomOutCycles > 0) {
        state.count = 0;
        state.zoomOutResolved = true;
        state.zoomOutCycles = 0;
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }
    
  } catch (err) {
    // silently fail
  }
  process.exit(0);
});
