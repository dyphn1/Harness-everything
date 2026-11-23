#!/usr/bin/env node
'use strict';

/**
 * Antigravity (AGY) PreToolUse Hook Adapter
 *
 * Intercepts tool execution to enforce:
 * - Worktree and filesystem boundary containment for file writes
 *   (allows writes inside any workspacePaths entry, cwd, or artifactDirectoryPath).
 * - Canonical Action Gate policies (destructive operations, forced pushes, publish, reset).
 *
 * Returns protojson: {"decision": "allow" | "deny" | "ask", "reason": "..."}
 */

const {
  readJsonStdin,
  getAgySessionId,
  getAgyWorkspacePaths,
  getAgyEffectiveCwd,
  isOutOfBoundsPath
} = require('./lib/agy-adapter-core');
const { evaluatePreToolUse } = require('./action-gate');

const FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content'
]);

function extractToolCall(payload) {
  if (!payload || typeof payload !== 'object') {
    return { id: undefined, name: '', args: {} };
  }
  const raw = payload.toolCall && typeof payload.toolCall === 'object' ? payload.toolCall : null;
  const name = (raw && raw.name) || payload.tool_name || payload.toolName || payload.tool || '';
  const args = (raw && raw.args && typeof raw.args === 'object')
    ? raw.args
    : ((payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {});
  const id = (raw && raw.id) || payload.tool_use_id || payload.toolUseId || undefined;
  return { id, name, args };
}

function collectAllowedWriteRoots(cwd, context = {}) {
  const payload = (context && context.payload) || {};
  const roots = [];
  if (Array.isArray(context.workspacePaths)) {
    for (const entry of context.workspacePaths) {
      if (typeof entry === 'string' && entry.trim()) roots.push(entry.trim());
    }
  }
  for (const entry of getAgyWorkspacePaths(payload)) {
    roots.push(entry);
  }
  if (typeof cwd === 'string' && cwd.trim()) {
    roots.push(cwd.trim());
  }
  const artifactDir = context.artifactDirectoryPath || payload.artifactDirectoryPath;
  if (typeof artifactDir === 'string' && artifactDir.trim()) {
    roots.push(artifactDir.trim());
  }
  return [...new Set(roots)];
}

function evaluateToolCall(toolCall, cwd, context = {}) {
  if (!toolCall || !toolCall.name) {
    return { decision: 'allow' };
  }

  const name = toolCall.name;
  const args = (toolCall.args && typeof toolCall.args === 'object') ? toolCall.args : {};

  // 1. Filesystem boundary containment for file mutations
  if (FILE_MUTATION_TOOLS.has(name)) {
    const rawPath = args.TargetFile ?? args.Path ?? args.path ?? args.targetFile ?? args.filePath ?? args.file_path;
    const filePath = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!filePath) {
      return {
        decision: 'deny',
        reason: `Harness boundary guard: missing target file path for ${name}.`
      };
    }

    const allowedRoots = collectAllowedWriteRoots(cwd, context);
    if (isOutOfBoundsPath(filePath, allowedRoots, cwd)) {
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

    const payload = context.payload || {};
    const sessionId = context.sessionId || getAgySessionId(payload) || undefined;
    const commandCwd = (typeof args.Cwd === 'string' && args.Cwd.trim())
      || (typeof args.cwd === 'string' && args.cwd.trim())
      || cwd;
    const toolUseId = toolCall.id || payload.tool_use_id || payload.toolUseId || undefined;

    const actionPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      cwd: commandCwd,
      ...(cwd ? { workspace_root: cwd } : {}),
      ...(sessionId ? { session_id: sessionId, sessionId } : {})
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
  const cwd = getAgyEffectiveCwd(payload);
  const toolCall = extractToolCall(payload);
  const sessionId = getAgySessionId(payload) || undefined;

  const result = evaluateToolCall(toolCall, cwd, { sessionId, payload });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) {
  main().catch(err => {
    // Fail closed on evaluation failure if error occurs
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: `Internal hook error: ${err.message}` }) + '\n');
  });
}

module.exports = { main, evaluateToolCall, extractToolCall };
