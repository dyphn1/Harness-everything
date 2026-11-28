#!/usr/bin/env node
'use strict';

// P2a-553: the Claude hook manifest must not register the retired E1 pilot
// capture routes, while the general PostToolUse / PostToolUseFailure / Stop
// registrations and the Codex native subagent adapters stay reachable.
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const ROOT = path.resolve(__dirname, '..');
const CLAUDE_MANIFEST = path.join(ROOT, 'hooks', 'hooks.json');
const CODEX_MANIFEST = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'hooks.json');

const RETIRED = [
  { id: 'harness:pre:pilot-capture', event: 'PreToolUse' },
  { id: 'harness:post-task:pilot-capture', event: 'PostToolUse' },
  { id: 'harness:subagent:start-capture', event: 'SubagentStart' },
  { id: 'harness:subagent:stop-capture', event: 'SubagentStop' },
];

// Drive the real manifest files, not a hand-built object (E-0008).
const claude = JSON.parse(fs.readFileSync(CLAUDE_MANIFEST, 'utf8'));
const codex = JSON.parse(fs.readFileSync(CODEX_MANIFEST, 'utf8'));
const hooks = claude.hooks || {};
const codexHooks = codex.hooks || {};
const groups = event => (Array.isArray(hooks[event]) ? hooks[event] : []);
const codexGroups = event => (Array.isArray(codexHooks[event]) ? codexHooks[event] : []);
const commands = group => ((group && group.hooks) || []).map(handler => (handler && handler.command) || '');
const registeredIds = () => Object.values(hooks).flat().map(group => group && group.id).filter(Boolean);
const check = (condition, id, detail) => helper.check(id, condition, detail);

// ---- Positive controls (must pass on the unchanged base) -------------------

check(groups('PostToolUse').some(group => group.id === 'harness:post:state-persist'),
  'p2a.claude.control.posttooluse-general-reachable',
  'general PostToolUse state-persist is absent from hooks/hooks.json');
check(groups('PostToolUseFailure').length > 0,
  'p2a.claude.control.posttoolusefailure-reachable',
  'PostToolUseFailure has no registrations');
check(groups('Stop').some(group => group.id === 'harness:stop:stop-gate') &&
      groups('Stop').some(group => group.id === 'harness:stop:workflow-completion-gate'),
  'p2a.claude.control.stop-reachable',
  'Stop lost the stop-gate or workflow-completion-gate registration');
check(groups('PostToolUse').some(group => group.matcher === 'Task' &&
      commands(group).some(command => /subagent-scope-guard\.js/.test(command))),
  'p2a.claude.control.task-post-general-preserved',
  'general Task post subagent-scope-guard was removed with the pilot capture');

// Positive control that reaches the real hook CLI: a general PostToolUse Bash
// still persists handoff state. Path-specific sentinel lives in the failure set.
helper.runHook('state-persist.js', {
  session_id: helper.SESSION_ID,
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_response: { stdout: 'p2a-reach-probe', exitCode: 0 },
}, { HARNESS_DOC_RECONCILIATION_PILOT: '0' });
check(helper.stateExists('handoff-state.json'),
  'p2a.claude.control.state-persist-reaches-code',
  'the general state-persist hook did not write handoff-state.json');

// Codex native subagent adapters live in the packaged manifest. P2a must not
// edit that file (coordinator owns the mirror), so they must remain reachable.
check(codexGroups('SubagentStart').some(group =>
      commands(group).some(command => /subagent-start\.js/.test(command))),
  'p2a.codex.control.subagent-start-adapter',
  'Codex SubagentStart adapter missing from plugins/harness-everything/hooks/hooks.json');
check(codexGroups('SubagentStop').some(group =>
      commands(group).some(command => /subagent-stop\.js/.test(command))),
  'p2a.codex.control.subagent-stop-adapter',
  'Codex SubagentStop adapter missing from plugins/harness-everything/hooks/hooks.json');

// ---- RED assertions: acceptance row ①, one path-specific sentinel each -----

for (const { id, event } of RETIRED) {
  check(!registeredIds().includes(id),
    `p2a.claude.${event}.${id}.absent`,
    `hooks/hooks.json still registers ${id} under ${event}`);
}
check(!Object.prototype.hasOwnProperty.call(hooks, 'SubagentStart') &&
      !Object.prototype.hasOwnProperty.call(hooks, 'SubagentStop'),
  'p2a.claude.subagent-events.absent',
  'Claude manifest still declares SubagentStart/SubagentStop capture events');
check(!groups('PreToolUse').some(group =>
      commands(group).some(command => /state-persist\.js/.test(command))),
  'p2a.claude.pre.state-persist.absent',
  'PreToolUse still routes to state-persist.js (pilot launch capture)');
check(!groups('PostToolUse').some(group =>
      commands(group).some(command => /state-persist\.js/.test(command)) &&
      /(?:^|\|)(Task|Agent)(?:\||$)/.test(group.matcher || '')),
  'p2a.claude.post-task.state-persist.absent',
  'PostToolUse still routes Task/Agent to state-persist.js (pilot result capture)');
check(!Object.values(hooks).flat().some(group =>
      /Pilot-only doc-reconciliation/.test((group && group.description) || '')),
  'p2a.claude.pilot-descriptions.absent',
  'a pilot-only doc-reconciliation registration remains in hooks/hooks.json');

helper.finish();
