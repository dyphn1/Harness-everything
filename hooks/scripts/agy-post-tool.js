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

  const toolResponse = safePayload.toolResponse || safePayload.tool_response || safePayload.result || {};
  const rawError = safePayload.error || toolResponse.error || '';
  const error = typeof rawError === 'string' ? rawError : (rawError ? JSON.stringify(rawError) : '');
  const stdout = toolResponse.stdout || (typeof safePayload.output === 'string' ? safePayload.output : '') || '';
  const stderr = toolResponse.stderr || (typeof error === 'string' ? error : '') || '';

  const rawExitCodes = [
    safePayload.exitCode,
    safePayload.exit_code,
    toolResponse.exitCode,
    toolResponse.exit_code
  ].filter(Number.isInteger);
  const exitCode = rawExitCodes.find(code => code !== 0) ?? rawExitCodes[0];

  const isFailed = Boolean(error && error.trim()) || (exitCode !== undefined && exitCode !== 0);

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
    error: isFailed ? (error || stderr || `Command exited with code ${exitCode}`) : '',
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

module.exports = { main, mapAgyPayloadToStatePersist };
