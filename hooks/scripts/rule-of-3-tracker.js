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
    const toolResponse = payload.tool_response || {};
    const stdout = toolResponse.stdout ?? payload.stdout ?? '';
    const stderr = toolResponse.stderr ?? payload.stderr ?? '';
    const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
    const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;

    const explicitFailure = exitCode !== undefined && exitCode !== 0;
    const explicitSuccess = exitCode === 0;
    const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
    const looksLikeError = /\b(error|fail|failed|failure|exception|fatal|panic|traceback|denied|refused|cannot|unable)\b/i.test(stderr);
    const isFailure = explicitFailure || (exitCode === undefined && stderrSignal && looksLikeError);
    const errorText = (stderrSignal ? stderr : stdout) || '';

    const stateFile = path.join(getSessionDir(getWorkspaceRoot(), payload.session_id), 'rule-of-3-state.json');

    let state = { count: 0, lastHash: null, zoomOutResolved: false, zoomOutCycles: 0, lastFailureAt: 0 };
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    if (isFailure && errorText) {
      // Enhanced failure signature detection with context-aware categorization
      // Hash includes: error message, file path, command attempted, and failure category
      const filePath = payload.tool_input?.file_path || payload.tool_input?.filePath || '';
      const command = payload.tool_input?.command || '';
      
      // Categorize failure type for context-aware thresholds
      let category = 'unknown';
      if (/SyntaxError|Unexpected token|Syntax Error/i.test(errorText)) {
        category = 'syntax';
      } else if (/ENOENT|not found|No such file|找不到|不存在/i.test(errorText)) {
        category = 'environment';
      } else if (/timeout|timed out|超時|逾時/i.test(errorText)) {
        category = 'timeout';
      } else if (/test.*fail|assertion|AssertionError|測試.*失敗|斷言.*錯誤/i.test(errorText)) {
        category = 'test';
      } else if (/permission|denied|EACCES|權限/i.test(errorText)) {
        category = 'permission';
      } else if (/dependency|module not found|Cannot find module|模組.*找不到/i.test(errorText)) {
        category = 'dependency';
      }
      
      // Normalize error text with context for better loop detection
      const normalized = errorText.slice(-400)
        .toLowerCase()
        .replace(/0x[0-9a-f]+/g, '#')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Include file path and command in hash for better context
      const contextString = `${category}:${filePath}:${command}:${normalized.slice(-200)}`;
      const hash = crypto.createHash('md5').update(contextString).digest('hex');

      // Context-aware thresholds: different failure types have different breaking points
      let threshold = 3; // Default: 3 strikes
      if (category === 'syntax') {
        threshold = 3; // Same syntax error 3 times = stop
      } else if (category === 'environment') {
        threshold = 4; // Environment issues may need more exploration
      } else if (category === 'test') {
        threshold = 3; // Same test failure 3 times = stop
      } else if (category === 'timeout') {
        threshold = 2; // Timeouts are expensive, fail faster
      } else if (category === 'permission') {
        threshold = 2; // Permission issues rarely resolve by retrying
      } else if (category === 'dependency') {
        threshold = 4; // Dependency issues may need different approaches
      }

      if (state.lastHash === hash) {
        state.count += 1;
        state.category = category; // Track failure category for smarter decisions
      } else {
        state.count = 1;
        state.lastHash = hash;
        state.category = category;
        // New signature = new problem: the zoom-out cycle budget starts over.
        state.zoomOutCycles = 0;
      }
      
      // Store threshold for this failure type
      state.threshold = threshold;
      
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