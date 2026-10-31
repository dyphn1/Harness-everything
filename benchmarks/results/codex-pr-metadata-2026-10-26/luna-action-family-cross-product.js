'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const repoRoot = path.resolve(process.argv[2] || process.cwd());
const gate = require(path.join(repoRoot, 'hooks/scripts/action-gate.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-action-cross-'));
const table = gate.loadRuleTable(path.join(repoRoot, 'hooks/scripts/action-gate-rules.json'));
const families = [undefined, 'mcp', 'local-function', 'shell', 'bogus'];
const actions = [undefined, 'read', 'unknown', 'mutate', 'delete', 'publish', 'deploy', 'send', 'bogus'];
const envelopes = [
  ['payload.action_descriptor', d => ({ action_descriptor: d })],
  ['payload.actionDescriptor', d => ({ actionDescriptor: d })],
  ['tool_input.action_descriptor', d => ({ tool_input: { ...baseInput, action_descriptor: d } })],
  ['tool_input.actionDescriptor', d => ({ tool_input: { ...baseInput, actionDescriptor: d } })],
  ['harness.action_descriptor', d => ({ harness: { action_descriptor: d } })],
  ['harness.actionDescriptor', d => ({ harness: { actionDescriptor: d } })],
];
const hintEnvelopes = [
  gateValue => ({ actionGate: gateValue }),
  gateValue => ({ workflowPlan: { actionGate: gateValue } }),
  gateValue => ({ routerContract: { workflowPlan: { actionGate: gateValue } } }),
  gateValue => ({ harness: { workflowPlan: { actionGate: gateValue } } }),
];
const unsafeFields = [
  { state: null },
  { base_branch: null },
  { maintainer_can_modify: null },
  { unknown_future_flag: null },
  { draft: null },
];
const baseInput = { repository_full_name: 'acme/repo', pr_number: 376, body: 'fixture' };
let sequence = 0;
let assertions = 0;
const failures = [];
function check(ok, label, actual) {
  assertions++;
  if (!ok && failures.length < 20) failures.push({ label, actual });
}
function merge(a, b) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b || {})) {
    const left = out[key];
    if (left && value && typeof left === 'object' && typeof value === 'object' && !Array.isArray(left) && !Array.isArray(value)) out[key] = merge(left, value);
    else out[key] = value;
  }
  return out;
}
function candidate(envelopeBuilder, descriptor, extra = {}) {
  let payload = {
    hook_event_name: 'PreToolUse',
    session_id: 'cross-product',
    tool_use_id: `cross-${sequence++}`,
    tool_name: 'mcp__codex_apps__github__update_pull_request',
    tool_input: { ...baseInput },
  };
  payload = merge(payload, extra);
  if (envelopeBuilder) payload = merge(payload, envelopeBuilder(descriptor));
  return payload;
}
function evaluate(payload) {
  return gate.evaluatePreToolUse(payload, {
    host: 'codex',
    ruleTable: table,
    sessionDir: path.join(root, 'session'),
  });
}
function descriptorFor(action, family) {
  const d = {};
  if (action !== undefined) d.action = action;
  if (family !== undefined) d.toolFamily = family;
  return d;
}
try {
  // Valid metadata arguments: every descriptor location/family/action combination.
  for (const [envelopeName, build] of envelopes) {
    for (const family of families) {
      for (const action of actions) {
        const p = candidate(build, descriptorFor(action, family));
        const result = evaluate(p);
        const expectedAction = ['delete', 'publish', 'deploy', 'send'].includes(action) ? action : 'mutate';
        const expectedDisposition = ['delete', 'publish', 'deploy', 'send'].includes(action) || envelopeName.startsWith('tool_input.') ? 'block' : 'allow';
        check(result.kind === expectedDisposition, `metadata action/family/envelope ${String(action)}/${String(family)}/${envelopeName}`, { kind: result.kind, rule: result.rule?.id });
        if (result.record) {
          check(result.record.actionDescriptor.action === expectedAction, `decision descriptor action ${String(action)}/${String(family)}/${envelopeName}`, { action: result.record.actionDescriptor.action });
          check(result.record.actionDescriptor.toolFamily === 'mcp', `decision descriptor family ${String(action)}/${String(family)}/${envelopeName}`, { family: result.record.actionDescriptor.toolFamily });
        }
        if (expectedDisposition === 'allow') {
          check(result.record?.disposition === 'deferred-to-host', `metadata audit ${String(action)}/${String(family)}/${envelopeName}`, { record: result.record?.disposition });
          check(result.record?.actionDescriptor.action === expectedAction, `metadata descriptor action ${String(action)}/${String(family)}/${envelopeName}`, { action: result.record?.actionDescriptor.action });
          check(result.record?.actionDescriptor.classification === 'gated', `metadata descriptor class ${String(action)}/${String(family)}/${envelopeName}`, { classification: result.record?.actionDescriptor.classification });
          check(result.record?.actionDescriptor.toolFamily === 'mcp', `metadata descriptor family ${String(action)}/${String(family)}/${envelopeName}`, { family: result.record?.actionDescriptor.toolFamily });
        }
      }
    }
  }
  // All four required hint envelopes must win over all optional envelopes for every action/family/descriptor source.
  for (const [envelopeName, build] of envelopes) {
    for (const family of families) {
      for (const action of actions) {
        for (let requiredAt = 0; requiredAt < hintEnvelopes.length; requiredAt++) {
          const hints = Object.assign({}, ...hintEnvelopes.map((make, i) => make({ required: i === requiredAt })));
          const p = candidate(build, descriptorFor(action, family), hints);
          const result = evaluate(p);
          check(result.kind === 'block' && result.exitCode === 2, `required hint ${requiredAt}/${String(action)}/${String(family)}/${envelopeName}`, { kind: result.kind, code: result.exitCode });
          check(result.record?.routerActionGate?.required === true, `required hint audit ${requiredAt}/${String(action)}/${String(family)}/${envelopeName}`, { hint: result.record?.routerActionGate });
        }
      }
    }
  }
  // Every additional field remains gated, including null values, across action/family/envelope variants.
  for (const [envelopeName, build] of envelopes) {
    for (const family of families) {
      for (const action of actions) {
        for (const unsafe of unsafeFields) {
          const p = candidate(build, descriptorFor(action, family));
          p.tool_input = { ...p.tool_input, ...unsafe };
          const result = evaluate(p);
          check(result.kind === 'block' && result.exitCode === 2, `unsafe field ${Object.keys(unsafe)[0]}/${String(action)}/${String(family)}/${envelopeName}`, { kind: result.kind, code: result.exitCode });
        }
      }
    }
  }
  // Bare/provider/flattened operation shapes and near misses.
  for (const name of [
    'update_pull_request',
    'mcp__github__update_pull_request',
    'mcp__codex_apps__github__update_pull_request',
    'mcp__codex_apps__github_update_pull_request',
    'mcp__demo__update_pull_request',
  ]) {
    const result = evaluate({ hook_event_name: 'PreToolUse', session_id: 'names', tool_use_id: `name-${sequence++}`, tool_name: name, tool_input: baseInput });
    check(result.kind === 'allow' && result.record?.actionDescriptor.action === 'mutate' && result.record?.actionDescriptor.classification === 'gated', `valid exact operation ${name}`, { kind: result.kind, action: result.record?.actionDescriptor.action });
  }
  for (const name of ['mcp__demo__update_pull_requests', 'mcp__demo__foo_update_pull_request', 'mcp__demo__update_pull_request_and_delete', 'mcp__codex_apps__github_update_pull_request_extra']) {
    const result = evaluate({ hook_event_name: 'PreToolUse', session_id: 'names', tool_use_id: `near-${sequence++}`, tool_name: name, tool_input: baseInput });
    check(result.kind === 'block' && result.exitCode === 2, `near-miss operation ${name}`, { kind: result.kind, code: result.exitCode });
  }
  console.log(JSON.stringify({ node: process.version, assertions, cases: sequence, failures: failures.length, firstFailures: failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
