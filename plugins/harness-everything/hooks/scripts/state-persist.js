#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');
const { cwdOf, classifyShell, isVerificationShell, directMutationInWorkspace, mutationPaths } = require('./lib/workflow-isolation');
const { getAgyWorkspacePaths, isOutOfBoundsPath } = require('./lib/agy-adapter-core');
const { observeTool } = require('./lib/telemetry');
const { readCodexToolOutcome } = require('./lib/codex-tool-outcome');
const codex = process.argv.includes('--codex');
const agy = process.argv.includes('--agy');

function agyMutationTargets(payload, toolName) {
  if (toolName === 'apply_patch') {
    return mutationPaths(payload).map(v => String(v || '').trim()).filter(Boolean);
  }
  const input = (payload && (payload.tool_input ?? payload.toolInput ?? payload.input)) || {};
  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.TargetFile,
    input.Path,
    input.targetFile
  ];
  const target = candidates.find(value => typeof value === 'string' && value.trim());
  return target ? [target.trim()] : [];
}

function agyDirectMutationInWorkspace(payload, mutationCwd, root, toolName) {
  const targets = agyMutationTargets(payload, toolName);
  if (targets.length === 0) return false;
  const agyRoots = getAgyWorkspacePaths(payload);
  if (typeof root === 'string' && root.trim() && !agyRoots.includes(root.trim())) {
    agyRoots.push(root.trim());
  }
  if (agyRoots.length === 0) return false;
  return targets.some(target => !isOutOfBoundsPath(target, agyRoots, mutationCwd));
}

function isSuccessfulMetadataStep(command, cwd) {
  // A line break starts a second shell command, so it can never be metadata-only.
  if (/[\r\n]/.test(String(command || ''))) return false;
  const text = String(command || '').trim();
  if (/[$`%!^]/.test(text)) return false;
  const value = '(?:"[^"\\r\\n]*"|\'[^\'\\r\\n]*\'|[^\\s;&|<>`$(){}]+)';
  const pattern = new RegExp(
    `^node\\s+(?<script>${value})\\s+step\\s+--session-id\\s+(?<session>${value})` +
    `\\s+--step-id\\s+(?<step>${value})\\s+--disposition\\s+(?<disposition>pass|blocked)` +
    `(?:\\s+--reason-code\\s+(?<reason>${value}))?\\s+--evidence\\s+(?<evidence>${value})$`
  );
  const match = pattern.exec(text);
  if (!match) return false;
  const unquote = token => token && token.length >= 2 &&
    ((token[0] === '"' && token[token.length - 1] === '"') || (token[0] === "'" && token[token.length - 1] === "'"))
    ? token.slice(1, -1) : token || '';
  const { script, session, step, disposition, reason, evidence } = match.groups;
  return path.resolve(cwd, unquote(script)) === path.join(__dirname, 'workflow-disposition.js')
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(unquote(session))
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(unquote(step))
    && Boolean(unquote(evidence).trim())
    && (disposition === 'pass' ? reason === undefined : /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(unquote(reason)));
}

// Old Claude manifests may still route retired E1 capture callbacks here.
// Ignore them before state resolution or any provider work.
const CAPTURE_ONLY_TOOLS = ['Task', 'Agent'];
let inputData = '';
const timeout = setTimeout(() => processState(null), 200);
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => { clearTimeout(timeout); try { processState(JSON.parse(inputData.trim())); } catch (_) { processState(null); } });
function processState(payload) {
  try {
    const sessionId = payload && (payload.session_id || payload.sessionId);
    const captureEventName = payload ? (payload.hook_event_name || payload.hookEventName) || '' : '';
    const captureToolName = payload ? (payload.tool_name || payload.tool || '') : '';
    const captureOnly = captureEventName === 'SubagentStart' || captureEventName === 'SubagentStop'
      || captureEventName === 'PreToolUse'
      || (captureEventName === 'PostToolUse' && CAPTURE_ONLY_TOOLS.indexOf(captureToolName) !== -1);
    if (captureOnly) {
      process.exit(0);
      return;
    }
    const root = getWorkspaceRoot(payload);
    const stateFile = path.join(getSessionDir(root, sessionId), 'handoff-state.json');
    let state = { status: 'idle', timestamp: new Date().toISOString() };
    if (fs.existsSync(stateFile)) { try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {} }
    if (!payload) {
      if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      process.exit(0);
    }
    const toolResponse = payload.tool_response || {};
    const codexResult = codex ? readCodexToolOutcome(payload) : null;
    const stdout = codexResult?.stdout ?? toolResponse.stdout ?? payload.stdout ?? '';
    const stderr = codexResult?.stderr ?? toolResponse.stderr ?? payload.stderr ?? payload.error ?? '';
    const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
    const exitCode = codex ? codexResult.exitCode
      : agy ? (Number.isInteger(rawExitCode) ? rawExitCode : undefined)
      : typeof rawExitCode === 'number' ? rawExitCode : undefined;
    const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
    const hookEvent = captureEventName;
    const isSuccessEvent = hookEvent === 'PostToolUse';
    const agyErrorSignal = agy && typeof payload.error === 'string' && payload.error.trim().length > 0;
    const isFailed = codex ? codexResult.outcome === 'failure' :
      hookEvent === 'PostToolUseFailure' || agyErrorSignal || (exitCode !== undefined && exitCode !== 0) ||
      (!isSuccessEvent && exitCode === undefined && stderrSignal);
    const verifiedSuccess = codex ? codexResult.outcome === 'success'
      : agy ? (!isFailed && exitCode === 0)
      : !isFailed && (isSuccessEvent || exitCode === 0);
    const toolName = payload.tool_name || payload.tool || 'command';
    if (isFailed) {
      let output = (stderrSignal ? stderr : stdout) || (typeof payload.output === 'string' ? payload.output : '');
      if (output.length > 500) output = '...' + output.slice(-500);
      state.status = 'failed'; state.timestamp = new Date().toISOString(); state.tool = toolName; state.exitCode = exitCode; state.errorSummary = output.trim();
    } else if (((!codex && !agy) || verifiedSuccess) && state.status === 'failed') {
      state.lastResolved = { tool: state.tool, timestamp: state.timestamp }; state.status = 'idle'; state.timestamp = new Date().toISOString(); delete state.exitCode; delete state.errorSummary;
    }
    const isDirectTool = toolName === 'Edit' || toolName === 'Write' || toolName === 'apply_patch';
    if (isDirectTool && (agy
      ? agyDirectMutationInWorkspace(payload, cwdOf(payload, root), root, toolName)
      : directMutationInWorkspace(payload, cwdOf(payload, root), root))) {
      state.lastEditAt = Date.now();
      if (agy) {
        const revision = Number.isSafeInteger(state.agyDirectMutationRevision) ? state.agyDirectMutationRevision : 0;
        if (revision < Number.MAX_SAFE_INTEGER) state.agyDirectMutationRevision = revision + 1;
      }
    }
    const isShell = toolName === 'Bash' || toolName === 'PowerShell' || toolName === 'exec_command';
    const command = (payload.tool_input && payload.tool_input.command) || '';
    if (isShell) {
      const commandClass = classifyShell(command);
      // These narrow AGY probes affect handoff tracking only.
      const agyReadOnlyProbe = agy && (
        command === '$PSVersionTable.PSVersion; Get-Command pwsh -ErrorAction SilentlyContinue'
        || /^git grep (?:-n )?(?:"[\w][\w.-]*"|'[\w][\w.-]*'|[\w][\w.-]*)(?: --(?: [\w.][\w./-]*)+)?$/.test(command)
      );
      const metadataStep = verifiedSuccess
        && isSuccessfulMetadataStep(command, cwdOf(payload, root));
      // The host-specific outcome must confirm success before verification advances.
      // Retired document-check evidence no longer changes generic handoff verification.
      const verifies = isVerificationShell(command, { cwd: cwdOf(payload, root), root });
      // On AGY hosts that omit shell error/exitCode, an unconfirmed verification-only command must not advance lastEditAt
      // and defeat agy-stop.js's bounded continuation fingerprint.
      const agyUnknownOutcomeVerify = agy && !verifiedSuccess && !isFailed && verifies;
      if (!metadataStep && !agyUnknownOutcomeVerify && !agyReadOnlyProbe && commandClass !== 'read-only' && commandClass !== 'worktree-setup') {
        state.lastEditAt = Date.now();
      }
      if (verifiedSuccess && verifies) {
        const verifiedAt = Date.now();
        const verifiedExitCode = exitCode ?? null;
        state.lastVerifyAt = verifiedAt;
        state.lastVerifyExitCode = verifiedExitCode;
      }
    }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    observeTool(payload);
  } catch (_) {}
  process.exit(0);
}
