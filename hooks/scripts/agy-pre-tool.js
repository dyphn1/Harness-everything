#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PreToolUse Hook Adapter
 *
 * Intercepts tool execution to enforce:
 * - Worktree and filesystem boundary containment for file writes.
 * - Canonical Action Gate policies (destructive operations, forced pushes, publish, reset).
 *
 * Returns protojson: {"decision": "allow" | "deny" | "ask", "reason": "..."}
 */

const { readJsonStdin, isOutOfBoundsPath } = require('./lib/agy-adapter-core');
const { evaluatePreToolUse } = require('./action-gate');

const FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content'
]);

function evaluateToolCall(toolCall, cwd, context = {}) {
  if (!toolCall || !toolCall.name) {
    return { decision: 'allow' };
  }

  const name = toolCall.name;
  const args = toolCall.args || {};

  // 1. Filesystem boundary containment for file mutations
  if (FILE_MUTATION_TOOLS.has(name)) {
    const filePath = args.TargetFile || args.Path || args.path || args.targetFile || args.filePath;
    if (filePath && isOutOfBoundsPath(filePath, cwd)) {
      return {
        decision: 'deny',
        reason: `Harness boundary guard: modification outside workspace root is forbidden (${filePath}).`
      };
    }
    return { decision: 'allow' };
  }

  // 2. Command safety via canonical Action Gate
  if (name === 'run_command') {
    const command = String(args.CommandLine || args.command || '').trim();
    if (!command) {
      return { decision: 'allow' };
    }

    const sessionId = context.sessionId || (context.payload && (context.payload.conversationId || context.payload.session_id || context.payload.sessionId));
    const actionPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      cwd,
      session_id: sessionId,
      sessionId: sessionId,
    };

    const gateResult = evaluatePreToolUse(actionPayload, { host: 'agy' });

    if (gateResult.kind === 'block') {
      const reason = gateResult.rule
        ? `[Harness actionGate:${gateResult.rule.id}] ${gateResult.rule.reason}`
        : (gateResult.stderr || 'Harness action gate: command rejected.');
      return { decision: 'deny', reason };
    }

    if (gateResult.kind === 'ask') {
      const reason = gateResult.rule
        ? `[Harness actionGate:${gateResult.rule.id}] ${gateResult.rule.reason}`
        : 'Harness action gate: confirmation required.';
      return { decision: 'ask', reason };
    }

    return { decision: 'allow' };
  }

  return { decision: 'allow' };
}

async function main() {
  const payload = await readJsonStdin();
  const cwd = payload.cwd || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || process.cwd();
  const toolCall = payload.toolCall || {};
  const sessionId = payload.conversationId || payload.session_id || payload.sessionId;

  const result = evaluateToolCall(toolCall, cwd, { sessionId, payload });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) {
  main().catch(err => {
    // Fail closed on evaluation failure if error occurs
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: `Internal hook error: ${err.message}` }) + '\n');
  });
}

module.exports = { main, evaluateToolCall };
