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
const { readJsonStdin } = require('./lib/agy-adapter-core');

function mapAgyPayloadToStatePersist(payload) {
  const sessionId = payload.conversationId || payload.session_id || payload.sessionId || '';
  const cwd = payload.cwd || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || process.cwd();
  const toolCall = payload.toolCall || {};
  const rawToolName = toolCall.name || payload.tool_name || payload.tool || '';
  const args = toolCall.args || payload.tool_input || {};

  let toolName = rawToolName;
  let toolInput = { ...args };

  if (rawToolName === 'run_command') {
    toolName = 'Bash';
    toolInput = { command: String(args.CommandLine || args.command || '').trim() };
  } else if (
    rawToolName === 'write_file' ||
    rawToolName === 'write_to_file' ||
    rawToolName === 'edit_file' ||
    rawToolName === 'replace_file_content' ||
    rawToolName === 'multi_replace_file_content'
  ) {
    toolName = 'Write';
    const filePath = args.TargetFile || args.Path || args.path || args.targetFile || args.filePath || '';
    toolInput = { file_path: filePath, ...args };
  }

  const toolResponse = payload.toolResponse || payload.tool_response || payload.result || {};
  const rawError = payload.error || toolResponse.error || '';
  const error = typeof rawError === 'string' ? rawError : (rawError ? JSON.stringify(rawError) : '');
  const stdout = toolResponse.stdout || (typeof payload.output === 'string' ? payload.output : '') || '';
  const stderr = toolResponse.stderr || (typeof error === 'string' ? error : '') || '';

  let exitCode = payload.exitCode;
  if (exitCode === undefined && toolResponse.exitCode !== undefined) exitCode = toolResponse.exitCode;
  if (exitCode === undefined && toolResponse.exit_code !== undefined) exitCode = toolResponse.exit_code;

  const isFailed = Boolean(error && error.trim()) || (typeof exitCode === 'number' && exitCode !== 0);

  return {
    hook_event_name: isFailed ? 'PostToolUseFailure' : 'PostToolUse',
    session_id: sessionId,
    sessionId: sessionId,
    conversationId: sessionId,
    cwd,
    workspacePaths: payload.workspacePaths || [cwd],
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
    spawnSync(process.execPath, [statePersistScript], {
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
