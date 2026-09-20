'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'harness-everything');
const HOOKS_FILE = path.join(PLUGIN, 'hooks', 'hooks.json');
const hooks = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8')).hooks;

const EXPECTED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop'
];

for (const event of EXPECTED_EVENTS) {
  assert.ok(Array.isArray(hooks[event]) && hooks[event].length > 0, `${event} hook missing`);
}

const hookText = JSON.stringify(hooks);
assert.match(hookText, /PLUGIN_ROOT/, 'OpenAI hooks must resolve from PLUGIN_ROOT');
assert.match(hookText, /commandWindows/, 'OpenAI hooks need Windows command overrides');

const commandPaths = [];
for (const entries of Object.values(hooks)) {
  for (const entry of entries) {
    for (const command of entry.hooks || []) {
      assert.strictEqual(command.type, 'command');
      assert.ok(command.commandWindows, 'every packaged command hook needs a Windows override');
      const match = command.command.match(/\$PLUGIN_ROOT\/([^"']+)/);
      if (match) commandPaths.push(path.join(PLUGIN, match[1]));
    }
  }
}
for (const commandPath of commandPaths) {
  assert.ok(fs.existsSync(commandPath), `packaged hook command is missing: ${path.relative(PLUGIN, commandPath)}`);
}

function filesUnder(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

for (const file of filesUnder(path.join(PLUGIN, 'hooks')).filter(file => file.endsWith('.js'))) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.strictEqual(syntax.status, 0, `${path.relative(PLUGIN, file)} does not parse: ${syntax.stderr}`);
}
assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', 'lib', 'advisory-text.js')));
const packagedState = fs.readFileSync(path.join(PLUGIN, 'hooks', 'scripts', 'lib', 'harness-state.js'), 'utf8');
assert.doesNotMatch(packagedState, /\.\.\/\.\.\/\.\.\/scripts[\\/]lib[\\/]workspace/);

function runHook(relative, payload, stateHome) {
  return spawnSync(process.execPath, [path.join(PLUGIN, relative)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, HARNESS_STATE_HOME: stateHome }
  });
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-openai-runtime-'));
const stateHome = path.join(fixture, 'state-home');
const gitInit = spawnSync('git', ['init', '--quiet'], { cwd: fixture, encoding: 'utf8' });
assert.strictEqual(gitInit.status, 0, gitInit.stderr);
const sessionPayload = {
  hook_event_name: 'SessionStart',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  source: 'startup'
};

const session = runHook('hooks/session-start.js', sessionPayload, stateHome);
assert.strictEqual(session.status, 0, session.stderr);
const sessionOutput = JSON.parse(session.stdout);
assert.strictEqual(sessionOutput.hookSpecificOutput.hookEventName, 'SessionStart');
assert.match(sessionOutput.hookSpecificOutput.additionalContext, /Route before execution/);
assert.match(sessionOutput.hookSpecificOutput.additionalContext, /Verify before claim/);

const persist = runHook('hooks/scripts/state-persist.js', {
  hook_event_name: 'PostToolUse',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  tool_name: 'apply_patch',
  tool_input: { command: '*** Begin Patch\n*** Update File: src/example.js\n*** End Patch' },
  tool_response: { exitCode: 0, stdout: '', stderr: '' }
}, stateHome);
assert.strictEqual(persist.status, 0, persist.stderr);

function findFile(root, filename) {
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, filename);
      if (found) return found;
    } else if (entry.isFile() && entry.name === filename) {
      return full;
    }
  }
  return null;
}

const handoff = findFile(stateHome, 'handoff-state.json');
assert.ok(handoff, 'SessionStart/state-persist should create a handoff state file');
assert.ok(JSON.parse(fs.readFileSync(handoff, 'utf8')).lastEditAt, 'apply_patch must count as an edit');

const sessionDir = path.dirname(handoff);
fs.writeFileSync(path.join(sessionDir, 'rule-of-3-state.json'), JSON.stringify({
  count: 3,
  threshold: 3,
  lastHash: 'runtime-test-failure',
  lastFailureAt: 0
}), 'utf8');
const reportFile = path.join(sessionDir, 'zoom-out-report.md');
const reportWrite = runHook('hooks/scripts/rule-of-3.js', {
  hook_event_name: 'PreToolUse',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  tool_name: 'apply_patch',
  tool_input: { patch: `*** Add File: ${reportFile}\n## Goal` }
}, stateHome);
assert.strictEqual(reportWrite.status, 0, 'apply_patch must be allowed to write the zoom-out report');

const mixedPatch = runHook('hooks/scripts/rule-of-3.js', {
  hook_event_name: 'PreToolUse',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  tool_name: 'apply_patch',
  tool_input: { patch: `*** Update File: ${reportFile}\n@@\n*** Update File: unrelated.txt\n@@` }
}, stateHome);
assert.strictEqual(mixedPatch.status, 2, 'report exemption must not allow a mixed apply_patch');

const blockedPatch = runHook('hooks/scripts/rule-of-3.js', {
  hook_event_name: 'PreToolUse',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  tool_name: 'apply_patch',
  tool_input: { patch: '*** Update File: unrelated.txt\n@@' }
}, stateHome);
assert.strictEqual(blockedPatch.status, 2, 'tripped circuit breaker must block unrelated apply_patch writes');

const subagentStart = runHook('hooks/scripts/subagent-start.js', {
  hook_event_name: 'SubagentStart',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  agent_type: 'worker'
}, stateHome);
assert.strictEqual(subagentStart.status, 0, subagentStart.stderr);
const subagentOutput = JSON.parse(subagentStart.stdout);
assert.strictEqual(subagentOutput.hookSpecificOutput.hookEventName, 'SubagentStart');
assert.match(subagentOutput.hookSpecificOutput.additionalContext, /scope/i);

fs.writeFileSync(path.join(fixture, 'unplanned-change.txt'), 'scope regression\n', 'utf8');
const subagentStop = runHook('hooks/scripts/subagent-stop.js', {
  hook_event_name: 'SubagentStop',
  session_id: 'openai-runtime-test',
  cwd: fixture,
  agent_type: 'worker'
}, stateHome);
assert.strictEqual(subagentStop.status, 0, subagentStop.stderr);
assert.match(subagentStop.stderr, /Subagent Scope Reminder/);

console.log('OpenAI plugin runtime compatibility verified.');
