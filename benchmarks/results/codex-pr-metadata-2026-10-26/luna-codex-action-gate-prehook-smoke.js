'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const repoRoot = path.resolve(process.argv[2] || process.cwd());
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-hook-boundary-'));
const hook = path.join(repoRoot, 'hooks/scripts/codex-action-gate-pre.js');
const env = {
  ...process.env,
  HARNESS_ACTION_GATE_HOST: 'codex',
  HARNESS_STATE_HOME: root,
  HARNESS_ACTION_GATE_STDIN_TIMEOUT_MS: '2000',
};
const input = { repository_full_name: 'acme/repo', pr_number: 376, body: 'fixture' };
const cases = [
  ['metadata', { tool_input: input }],
  ['required', { tool_input: input, workflowPlan: { actionGate: { required: true } } }],
  ['descriptor-read-shell', { tool_input: input, action_descriptor: { action: 'read', toolFamily: 'shell' } }],
  ['unsafe-state-null-required', { tool_input: { ...input, state: null }, action_descriptor: { action: 'read', toolFamily: 'shell' }, actionGate: { required: true } }],
  ['delete-shell', { tool_input: input, action_descriptor: { action: 'delete', toolFamily: 'shell' } }],
  ['near-name', { tool_name: 'mcp__demo__update_pull_requests', tool_input: input }],
  ['conflicting-harness-required', {
    tool_input: input,
    actionGate: { required: false },
    workflowPlan: { actionGate: { required: false } },
    routerContract: { workflowPlan: { actionGate: { required: false } } },
    harness: { workflowPlan: { actionGate: { required: true } } },
  }],
];
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
try {
  console.log(`Node ${process.version}; repo ${repoRoot}`);
  for (let i = 0; i < cases.length; i++) {
    const [label, extra] = cases[i];
    const toolUseId = `hook-${i}`;
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: `hook-review-${i}`,
      turn_id: 'hook-review',
      tool_use_id: toolUseId,
      tool_name: 'mcp__codex_apps__github__update_pull_request',
      ...extra,
    };
    const result = cp.spawnSync(process.execPath, [hook], {
      cwd: root,
      env,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 20000,
    });
    const audit = files(root).filter(file => file.endsWith('.json')).map(file => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    }).find(record => record?.toolUseId === toolUseId);
    const summary = {
      label,
      exitCode: result.status,
      stdout: result.stdout.trim(),
      matchedRule: audit?.matchedRule || null,
      disposition: audit?.disposition || null,
      action: audit?.actionDescriptor?.action || null,
      family: audit?.actionDescriptor?.toolFamily || null,
      classification: audit?.actionDescriptor?.classification || null,
      required: audit?.routerActionGate?.required ?? null,
    };
    console.log(JSON.stringify(summary));
    if (result.error || result.status === null) throw result.error || new Error(`${label}: no process status`);
    const expectedAllow = label === 'metadata' || label === 'descriptor-read-shell';
    if (expectedAllow ? result.status !== 0 : result.status !== 2) throw new Error(`${label}: unexpected exit ${result.status}`);
    if (expectedAllow && (audit?.actionDescriptor?.action !== 'mutate' || audit?.actionDescriptor?.toolFamily !== 'mcp')) throw new Error(`${label}: expected audited MCP mutation`);
    if (!expectedAllow && result.status === 2 && !audit) throw new Error(`${label}: missing block audit`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
