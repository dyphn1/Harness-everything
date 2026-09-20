#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');
const { createLearningOpportunity } = require('./lib/learning-opportunity');

// PostToolUse/PostToolUseFailure hooks in Claude Code receive their payload via stdin
let inputData = '';

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    const hookEventName = payload.hook_event_name || payload.hookEventName || '';
    const isFailureEvent = hookEventName === 'PostToolUseFailure';
    const isSuccessEvent = hookEventName === 'PostToolUse';
    const toolResponse = payload.tool_response || {};
    const stdout = toolResponse.stdout ?? payload.stdout ?? '';
    const stderr = toolResponse.stderr ?? payload.stderr ?? '';
    const failureText = typeof payload.error === 'string' ? payload.error : '';
    const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode ?? payload.exit_code;
    const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;
    const toolName = payload.tool_name || payload.tool || 'command';
    const toolInput = payload.tool_input || {};
    const filePath = toolInput.file_path || toolInput.filePath || '';
    const command = toolInput.command || '';
    const operationHash = crypto.createHash('md5').update(`${toolName}:${filePath}:${command}`).digest('hex');

    const explicitFailure = exitCode !== undefined && exitCode !== 0;
    const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
    const looksLikeError = /\b(error|fail|failed|failure|exception|fatal|panic|traceback|denied|refused|cannot|unable)\b/i.test(stderr);
    const isFailure = isFailureEvent || explicitFailure ||
      (!isSuccessEvent && exitCode === undefined && stderrSignal && looksLikeError);
    const errorText = isFailureEvent
      ? (failureText || (stderrSignal ? stderr : stdout) || '')
      : ((stderrSignal ? stderr : stdout) || failureText || '');

    const root = getWorkspaceRoot(payload);
    const stateFile = path.join(getSessionDir(root, payload.session_id || payload.sessionId), 'rule-of-3-state.json');

    let state = { count: 0, lastHash: null, lastOperationHash: null, zoomOutResolved: false, zoomOutCycles: 0, lastFailureAt: 0 };
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    if (isFailure && errorText) {
      // Enhanced failure signature detection with context-aware categorization
      // Hash includes: error message, file path, command attempted, and failure category
      // Categorize failure type for context-aware thresholds.
      // NOTE (#167): match anchored diagnostic phrases, not bare substrings.
      // A bare `denied`/`timeout` substring matches file names such as
      // `workflow-mutation-denied.js` and misclassifies the failure.
      let category = 'unknown';
      if (/\bSyntaxError\b|Unexpected token|Syntax Error/i.test(errorText)) {
        category = 'syntax';
      } else if (/\bENOENT\b|\bnot found\b|No such file|找不到|不存在/i.test(errorText)) {
        category = 'environment';
      } else if (/\bETIMEDOUT\b|TimeoutError|\btimeout\b|\btimed out\b|\btiming out\b|超時|逾時/i.test(errorText)) {
        category = 'timeout';
      } else if (/test.*fail|assertion|AssertionError|測試.*失敗|斷言.*錯誤/i.test(errorText)) {
        category = 'test';
      } else if (/\bpermission denied\b|\bEACCES\b|\bEPERM\b|權限.*(拒絕|不足|被拒)|拒絕.*權限/i.test(errorText)) {
        category = 'permission';
      } else if (/\bdependency\b|\bmodule not found\b|Cannot find module|模組.*找不到/i.test(errorText)) {
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

      // One deliberately simple policy: three repeats of the same signature trigger zoom-out.
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
      state.lastOperationHash = operationHash;

      // Any fresh failure re-arms the breaker. Without this, a signature that
      // failed again after a success (or after a zoom-out release) would keep
      // zoomOutResolved=true and the breaker could never trip on it again.
      state.zoomOutResolved = false;
      // rule-of-3.js only honors a zoom-out report written AFTER this moment,
      // so a stale report can't unlock a later trip.
      state.lastFailureAt = Date.now();

      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    } else if (!isFailure && state.lastOperationHash === operationHash) {
      // Unrelated successes must not erase a repeated-failure signature.
      // A success for the same operation is the objective recovery boundary.
      if ((state.zoomOutCycles || 0) > 0 && state.lastHash) {
        const toolEventId = payload.tool_use_id || payload.toolUseId || `success-${Date.now()}`;
        try {
          createLearningOpportunity(payload, {
            triggerType: 'rule-of-3-recovery',
            sourceEventIds: [
              `rule-of-3:${state.lastHash}:${state.lastFailureAt || 0}`,
              `tool:${toolEventId}`,
            ],
            evidence: {
              failureSignature: state.lastHash,
              failureCategory: state.category || 'unknown',
              zoomOutCycles: state.zoomOutCycles,
              recovered: true,
            },
          });
        } catch (_) {
          // Learning capture is additive and must never break recovery tracking.
        }
      }
      if (state.count > 0 || state.zoomOutCycles > 0 || state.lastHash) {
        state.count = 0;
        state.lastHash = null;
        state.lastOperationHash = null;
        state.zoomOutResolved = true;
        state.zoomOutCycles = 0;
        state.lastFailureAt = 0;
        delete state.category;
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }

  } catch (err) {
    // silently fail
  }
  process.exit(0);
});
