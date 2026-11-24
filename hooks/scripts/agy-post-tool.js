#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PostToolUse Hook Adapter
 *
 * Captures tool outcomes, tracks execution errors and file edits for state persistence.
 * Bridges AGY tool execution to Harness session state (handoff-state.json).
 * Returns empty JSON object `{}` on stdout as required by AGY protocol.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const {
  readJsonStdin,
  getAgySessionId,
  getAgyEffectiveCwd
} = require('./lib/agy-adapter-core');

const FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'write_to_file',
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content'
]);

const FAILED_STATUSES = new Set([
  'failed',
  'fail',
  'error',
  'errored',
  'timed_out',
  'timeout',
  'cancelled',
  'canceled',
  'aborted'
]);

function normalizeErrorText(rawError) {
  if (typeof rawError === 'string') return rawError.trim();
  if (rawError === null || rawError === undefined || rawError === false) return '';
  if (typeof rawError === 'object') {
    if (Array.isArray(rawError) && rawError.length === 0) return '';
    if (!Array.isArray(rawError) && Object.keys(rawError).length === 0) return '';
  }
  const serialized = JSON.stringify(rawError);
  return typeof serialized === 'string' ? serialized.trim() : '';
}

function hasExplicitFailureFlag(obj) {
  return obj.isError === true
    || obj.is_error === true
    || obj.success === false
    || obj.ok === false
    || obj.interrupted === true;
}

function classifyStructuredOutcome(safePayload, responseObj, error) {
  const rawExitCodes = [
    safePayload.exitCode,
    safePayload.exit_code,
    responseObj.exitCode,
    responseObj.exit_code
  ].filter(Number.isInteger);
  const nonzeroCode = rawExitCodes.find(code => code !== 0);
  const exitCode = nonzeroCode ?? rawExitCodes[0];

  const statuses = [safePayload.status, responseObj.status]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLowerCase());

  // Structured host errors, failure flags, and nonzero exit codes win over any
  // zero or generic metadata fields. Text-only stdout/output markers are never parsed here
  // because retained AGY captures do not distinguish host metadata from stdout.
  const isFailed = Boolean(error && error.trim())
    || (exitCode !== undefined && exitCode !== 0)
    || hasExplicitFailureFlag(safePayload)
    || hasExplicitFailureFlag(responseObj)
    || statuses.some(status => FAILED_STATUSES.has(status));

  return {
    isFailed,
    exitCode: isFailed ? (exitCode !== undefined && exitCode !== 0 ? exitCode : undefined) : exitCode
  };
}

function mapAgyPayloadToStatePersist(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const sessionId = getAgySessionId(safePayload);
  const workspaceCwd = getAgyEffectiveCwd(safePayload);
  const toolCall = (safePayload.toolCall && typeof safePayload.toolCall === 'object') ? safePayload.toolCall : {};
  const rawToolName = toolCall.name || safePayload.tool_name || safePayload.toolName || safePayload.tool || '';
  const args = (toolCall.args && typeof toolCall.args === 'object')
    ? toolCall.args
    : ((safePayload.tool_input && typeof safePayload.tool_input === 'object') ? safePayload.tool_input : {});

  let toolName = rawToolName;
  let toolInput = { ...args };
  let effectiveCwd = workspaceCwd;

  if (rawToolName === 'run_command') {
    toolName = 'Bash';
    const command = String(args.CommandLine || args.command || '').trim();
    const commandCwd = (typeof args.Cwd === 'string' && args.Cwd.trim())
      || (typeof args.cwd === 'string' && args.cwd.trim())
      || workspaceCwd;
    effectiveCwd = commandCwd;
    toolInput = {
      command,
      ...(commandCwd ? { cwd: commandCwd } : {})
    };
  } else if (FILE_MUTATION_TOOLS.has(rawToolName)) {
    toolName = 'Write';
    const filePath = args.TargetFile || args.Path || args.path || args.targetFile || args.filePath || args.file_path || '';
    toolInput = { ...args, file_path: filePath };
  }

  const rawResponse = safePayload.toolResponse || safePayload.tool_response || safePayload.result;
  const responseObj = (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse))
    ? rawResponse
    : {};
  const error = normalizeErrorText(safePayload.error) || normalizeErrorText(responseObj.error);
  const stdout = (typeof responseObj.stdout === 'string' && responseObj.stdout)
    || (typeof safePayload.stdout === 'string' && safePayload.stdout)
    || (typeof safePayload.output === 'string' && safePayload.output)
    || (typeof rawResponse === 'string' && rawResponse)
    || '';
  const stderr = (typeof responseObj.stderr === 'string' && responseObj.stderr)
    || (typeof safePayload.stderr === 'string' && safePayload.stderr)
    || error
    || '';

  const { isFailed, exitCode } = classifyStructuredOutcome(safePayload, responseObj, error);

  return {
    hook_event_name: isFailed ? 'PostToolUseFailure' : 'PostToolUse',
    session_id: sessionId,
    sessionId: sessionId,
    conversationId: sessionId,
    cwd: effectiveCwd,
    workspace_root: workspaceCwd,
    workspacePaths: (Array.isArray(safePayload.workspacePaths) && safePayload.workspacePaths.length > 0)
      ? safePayload.workspacePaths
      : [workspaceCwd],
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {
      stdout,
      stderr,
      ...(exitCode !== undefined ? { exitCode } : {})
    },
    error: isFailed
      ? (error || stderr || (exitCode !== undefined ? `Command exited with code ${exitCode}` : 'Tool execution failed'))
      : '',
    ...(exitCode !== undefined ? { exitCode } : {})
  };
}

async function main() {
  const payload = await readJsonStdin();

  try {
    const mapped = mapAgyPayloadToStatePersist(payload);
    const statePersistScript = path.join(__dirname, 'state-persist.js');
    spawnSync(process.execPath, [statePersistScript, '--agy'], {
      input: JSON.stringify(mapped),
      encoding: 'utf8',
      env: process.env,
      timeout: 10000
    });
  } catch (err) {
    if (process.env.HARNESS_DEBUG) {
      console.error('[AGY-PostToolUse] State persistence error:', err);
    }
  }

  process.stdout.write('{}\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write('{}\n');
  });
}

module.exports = { main, mapAgyPayloadToStatePersist, classifyStructuredOutcome };
