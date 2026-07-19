#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    const isFailure = explicitFailure || (exitCode === undefined && stderrSignal);
    const errorText = (stderrSignal ? stderr : stdout) || '';

    const stateDir = path.join(process.cwd(), '.harness');
    const stateFile = path.join(stateDir, 'rule-of-3-state.json');

    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    let state = { count: 0, lastHash: null, zoomOutResolved: false };
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    if (isFailure && errorText) {
      // Create a hash of the last 200 chars of the error to identify identical loops
      const errorStr = errorText.slice(-200).trim();
      const hash = crypto.createHash('md5').update(errorStr).digest('hex');

      if (state.lastHash === hash) {
        state.count += 1;
      } else {
        state.count = 1;
        state.lastHash = hash;
        state.zoomOutResolved = false;
      }

      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    } else if (explicitSuccess) {
      // Only reset on a *confirmed* zero exit code, not merely "not a failure".
      if (state.count > 0) {
        state.count = 0;
        state.zoomOutResolved = true;
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }
    
  } catch (err) {
    // silently fail
  }
  process.exit(0);
});
