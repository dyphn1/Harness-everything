#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PreToolUse Hook Adapter
 *
 * Intercepts tool execution (run_command, write_file, edit_file) to enforce:
 * - Worktree and filesystem boundary containment.
 * - Action gate policies (destructive operations, forced pushes).
 *
 * Returns protojson: {"decision": "allow" | "deny" | "ask", "reason": "..."}
 */

const { readJsonStdin, isOutOfBoundsPath } = require('./lib/agy-adapter-core');

function evaluateToolCall(toolCall, cwd) {
  if (!toolCall || !toolCall.name) {
    return { decision: 'allow' };
  }

  const name = toolCall.name;
  const args = toolCall.args || {};

  // 1. Filesystem boundary containment for file mutations
  if (name === 'write_file' || name === 'edit_file') {
    const filePath = args.Path || args.path;
    if (filePath && isOutOfBoundsPath(filePath, cwd)) {
      return {
        decision: 'deny',
        reason: `Harness boundary guard: modification outside workspace root is forbidden (${filePath}).`
      };
    }
  }

  // 2. Command safety and action gate evaluation
  if (name === 'run_command') {
    const command = String(args.CommandLine || args.command || '').trim();

    // Dangerous destructive commands
    if (/\brm\s+-(?:r[fF]|[fF]r)\s+(?:\/|~|\$HOME)(?:\s|$|;|\*)/.test(command)) {
      return {
        decision: 'deny',
        reason: 'Harness action gate: destructive filesystem command rejected.'
      };
    }

    // Direct force-push to protected branches
    if (/\bgit\s+push\s+.*--force.*\b(main|master)(?:\s|$|;)/.test(command)) {
      return {
        decision: 'deny',
        reason: 'Harness action gate: force-push to main branch is strictly forbidden.'
      };
    }

    // Git hard reset without isolation check
    if (/\bgit\s+reset\s+--hard\b/.test(command) && process.env.HARNESS_STRICT_ISOLATION === '1') {
      return {
        decision: 'ask',
        reason: 'Harness action gate: hard git reset requires confirmation.'
      };
    }
  }

  return { decision: 'allow' };
}

async function main() {
  const payload = await readJsonStdin();
  const cwd = payload.cwd || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || process.cwd();
  const toolCall = payload.toolCall || {};

  const result = evaluateToolCall(toolCall, cwd);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) {
  main().catch(err => {
    // Fail closed on evaluation failure if error occurs
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: `Internal hook error: ${err.message}` }) + '\n');
  });
}

module.exports = { main, evaluateToolCall };
