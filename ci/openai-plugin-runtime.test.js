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

function runHook(relative, payload, stateHome, args = []) {
  return spawnSync(process.execPath, [path.join(PLUGIN, relative), ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, HARNESS_STATE_HOME: stateHome }
  });
}

function registeredHooks(event, tool) {
  return (hooks[event] || [])
    .filter(group => !group.matcher || group.matcher.split('|').some(pattern =>
      pattern === tool || pattern === '.*' || (pattern.endsWith('.*') && tool.startsWith(pattern.slice(0, -2)))))
    .flatMap(group => group.hooks || []);
}

function runRegistered(event, tool, payload, stateHome) {
  return registeredHooks(event, tool).map(hook => {
    const match = hook.command.match(/^node "\$\{PLUGIN_ROOT\}\/([^"]+)"(.*)$/);
    assert.ok(match, `unrecognized packaged hook command: ${hook.command}`);
    const args = match[2].trim().split(/\s+/).filter(Boolean);
    return runHook(match[1], { ...payload, hook_event_name: event, tool_name: tool }, stateHome, args);
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
assert.doesNotMatch(hookText, /rule-of-3(?:-tracker)?\.js|reset-circuit-breaker\.js/,
  'packaged Codex hooks must not register retired breaker entry points');

const legacyState = { count: 3, lastHash: 'legacy-trip', zoomOutResolved: false, lastFailureAt: 123, zoomOutCycles: 0 };
const legacyStateFile = path.join(sessionDir, 'rule-of-3-state.json');
const reportFile = path.join(sessionDir, 'zoom-out-report.md');
const note = 'agent-authored recovery note\n';
fs.writeFileSync(legacyStateFile, JSON.stringify(legacyState), 'utf8');
fs.writeFileSync(reportFile, note, 'utf8');
const resumedSession = runHook('hooks/session-start.js', sessionPayload, stateHome);
assert.strictEqual(resumedSession.status, 0, resumedSession.stderr);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(legacyStateFile, 'utf8')), legacyState,
  'Codex startup leaves stale breaker state inert and intact');
assert.strictEqual(fs.readFileSync(reportFile, 'utf8'), note,
  'Codex startup preserves optional agent-authored notes');

for (const scenario of [
  { name: 'fresh', state: null, command: `${process.execPath} -e "process.exit(1)"`, response: { exitCode: 1, stderr: 'fixture failure' } },
  { name: 'legacy-tripped', state: legacyState, command: `${process.execPath} -e "process.stdout.write('permitted')"`, response: { exitCode: 0, stdout: 'permitted' } },
]) {
  if (scenario.state) fs.writeFileSync(legacyStateFile, JSON.stringify(scenario.state), 'utf8');
  else fs.rmSync(legacyStateFile, { force: true });
  const payload = {
    host: 'codex', session_id: 'openai-runtime-test', cwd: fixture,
    tool_use_id: `r1-${scenario.name}`, tool_input: { command: scenario.command },
  };
  const before = runRegistered('PreToolUse', 'Bash', payload, stateHome);
  assert.ok(before.every(result => result.status === 0), `${scenario.name} pre-tool hooks should permit this command: ${before.map(item => item.stderr).join('\n')}`);
  const call = spawnSync(process.execPath, ['-e', scenario.name === 'fresh' ? 'process.exit(1)' : 'process.stdout.write("permitted")'], {
    cwd: fixture, encoding: 'utf8',
  });
  assert.strictEqual(call.status, scenario.response.exitCode, `${scenario.name} otherwise-permitted tool call must run`);
  const after = runRegistered('PostToolUse', 'Bash', { ...payload, tool_response: scenario.response }, stateHome);
  assert.ok(after.every(result => result.status === 0), `${scenario.name} result hooks should complete: ${after.map(item => item.stderr).join('\n')}`);
  if (scenario.state) {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(legacyStateFile, 'utf8')), legacyState,
      'legacy tripped state remains unchanged after the next tool call');
  } else {
    assert.strictEqual(fs.existsSync(legacyStateFile), false, 'fresh tool call creates no breaker state');
  }
}

const denied = runRegistered('PreToolUse', 'mcp__codex_apps__github__delete_issue', {
  host: 'codex', session_id: 'openai-runtime-test', cwd: fixture, tool_use_id: 'r1-denied-control',
  tool_input: { repository_full_name: 'example/repo', issue_number: 7 },
}, stateHome);
assert.strictEqual(denied.length, 1);
assert.strictEqual(denied[0].status, 2, 'the independent Codex action gate still blocks a destructive MCP action');
assert.match(denied[0].stderr, /no Harness-verified ask-style decision path/);

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
assert.strictEqual(subagentStop.stderr, '');
assert.match(JSON.parse(subagentStop.stdout).systemMessage, /Subagent Scope Reminder.*[\s\S]*unplanned-change\.txt/);

console.log('OpenAI plugin runtime compatibility verified.');
