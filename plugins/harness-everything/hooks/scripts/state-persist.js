#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');
const { cwdOf, classifyShell, isVerificationShell, directMutationInWorkspace } = require('./lib/workflow-isolation');
const { observeTool } = require('./lib/telemetry');

// S2b doc-reconciliation pilot capture (docs/doc-workflow-reconciliation.md
// § S2b "Activation and pilot-only scope", "Claude capture and origin-provider
// contract"): pilot-only, fail-open to the host, and gated on the exact
// switch value `1` before any collector logic runs. OFF must return to the
// existing legacy path before pilot collection; capture never executes a
// command, verifier or generator and never blocks a tool or Stop.
const PILOT_CAPTURE_EVENT_NAMES = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'];
// Task/Agent results were never routed here before S2b, so they stay capture-only: the legacy handoff path does not run for them.
const CAPTURE_ONLY_TOOLS = ['Task', 'Agent'];
let inputData = '';
const timeout = setTimeout(() => processState(null), 200);
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => { clearTimeout(timeout); try { processState(JSON.parse(inputData.trim())); } catch (_) { processState(null); } });
function processState(payload) {
  try {
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const root = getWorkspaceRoot(payload);
    const captureEventName = payload ? (payload.hook_event_name || payload.hookEventName) || '' : '';
    // SubagentStart/SubagentStop were never routed to this script before S2b.
    // They are capture-only events: the legacy handoff state path stays
    // untouched for them, so wiring them while OFF adds no writes at all.
    if (captureEventName === 'SubagentStart' || captureEventName === 'SubagentStop') {
      persistPilotCapture(payload, captureEventName, sessionId, root);
      process.exit(0);
      return;
    }
    // Pre-tool launch capture and Task/Agent result capture: capture-only, no legacy handoff state is written.
    const captureToolName = payload ? (payload.tool_name || payload.tool || '') : '';
    if (captureEventName === 'PreToolUse' || (captureEventName === 'PostToolUse' && CAPTURE_ONLY_TOOLS.indexOf(captureToolName) !== -1)) {
      persistPilotCapture(payload, captureEventName, sessionId, root);
      process.exit(0);
      return;
    }
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
    const hookEvent = captureEventName;
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
      // Verification evidence needs a confirmed success: a PostToolUse event or an explicit zero exit.
      // Pilot ON only: a registered, argv-validated doc-check that resolves to this install's own runtime is the document
      // verification evidence, and only at the shipped pin (R3-02). Any other path earns no verification evidence. OFF stays legacy.
      const docCheck = process.env.HARNESS_DOC_RECONCILIATION_PILOT === '1' ? require('./lib/doc-reconciliation-provider') : null;
      const installedCheck = docCheck && docCheck.registeredInstalledCheck(command, cwdOf(payload, root));
      const verifies = installedCheck
        ? docCheck.fileDigest(installedCheck.installed) === docCheck.SHIPPED_DOC_CHECK_DIGEST
        : isVerificationShell(command, { cwd: cwdOf(payload, root), root });
      if (!isFailed && (isSuccessEvent || exitCode === 0) && verifies) { state.lastVerifyAt = Date.now(); state.lastVerifyExitCode = exitCode ?? null; }
    }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    observeTool(payload);
    persistPilotCapture(payload, captureEventName, sessionId, root);
  } catch (_) {}
  process.exit(0);
}

// Pilot-only capture journaling. Every guard is placed before any collector
// work; any failure is swallowed (fail-open), and the hook output/exit is
// never changed by capture.
function persistPilotCapture(payload, eventName, sessionId, root) {
  try {
    if (!payload || process.env.HARNESS_DOC_RECONCILIATION_PILOT !== '1') return;
    if (PILOT_CAPTURE_EVENT_NAMES.indexOf(eventName) === -1) return;
    const provider = require('./lib/doc-reconciliation-provider');
    const entry = provider.buildCaptureRecord(payload, eventName, root);
    if (!entry) return;
    const sessionDir = getSessionDir(root, sessionId);
    // Observation-time identity: the workflow and pin in force when the host event was captured.
    const observed = provider.observedIdentityFor(sessionDir);
    if (observed) entry.observedIdentity = observed;
    // Each capture is one exclusively created event file; the compatibility journal is rebuilt from them (not tamper-proof).
    provider.writeImmutableEvent(sessionDir, entry);
    provider.rebuildJournalView(sessionDir);
  } catch (_) { /* fail-open: capture failures never reach the host */ }
}
