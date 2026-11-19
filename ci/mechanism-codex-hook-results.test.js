'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pluginRoot = path.join(root, 'plugins', 'harness-everything');
const manifest = require('../plugins/harness-everything/hooks/hooks.json');
const { getSessionDir, getStateRoot } = require('../hooks/scripts/lib/harness-state');

function registeredHook(event, script) {
  const handler = manifest.hooks[event].flatMap(group => group.hooks)
    .find(hook => hook.command.includes('/' + script + '"'));
  assert.ok(handler, script + ' is registered');
  const match = /^node "\$\{PLUGIN_ROOT\}\/([^"]+)"( --codex)?$/.exec(handler.command);
  assert.ok(match, handler.command);
  assert.equal(handler.commandWindows,
    'node "${PLUGIN_ROOT}\\' + match[1].replaceAll('/', '\\') + '"' + (match[2] || ''));
  return match[2] ? [match[1], '--codex'] : [match[1]];
}

function spawn(executable, args, cwd, input) {
  const result = spawnSync(executable, args, { cwd, input, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-hook-results-'));
process.env.HARNESS_STATE_HOME = path.join(temp, 'state');
delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;

try {
  for (const layout of [root, pluginRoot]) {
    const label = layout === root ? 'source' : 'package';
    const cwd = path.join(temp, 'workspace ' + label);
    const session_id = 'codex-result-' + label;
    fs.mkdirSync(cwd);
    spawn('git', ['init', '-q'], cwd);

    function hook(event, script, fields = {}) {
      const [relative, ...args] = registeredHook(event, script);
      return spawn(process.execPath, [path.join(layout, relative), ...args], cwd,
        JSON.stringify({ hook_event_name: event, cwd, session_id, ...fields }));
    }

    const session = getSessionDir(cwd, session_id);
    const checkCommand = 'npm test';
    const shell = { tool_name: 'Bash', tool_input: { command: checkCommand } };

    const runRoot = path.join(getStateRoot(cwd), 'fable-runs', 'result-run');
    const contract = path.join(runRoot, 'contracts', 'check.json');
    const evidence = path.join(runRoot, 'evidence', 'check.json');
    fs.mkdirSync(path.dirname(contract), { recursive: true });
    fs.writeFileSync(contract, JSON.stringify({
      schemaVersion: 2, planId: 'result-plan', runId: 'result-run', stageId: 'check',
      sessionId: session_id, status: 'pending', checkCommand,
    }));
    function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    function post(response) {
      for (const script of ['state-persist.js', 'rule-of-3-tracker.js', 'contract-test.js']) {
        hook('PostToolUse', script, { ...shell, tool_response: response });
      }
    }

    const handoff = path.join(session, 'handoff-state.json');
    const tracker = path.join(session, 'rule-of-3-state.json');
    post({ exit_code: 1, stderr: 'test failed' });
    assert.equal(read(handoff).status, 'failed');
    assert.equal(read(tracker).count, 1);
    assert.equal(read(contract).status, 'fail');
    function evidenceSnapshot() {
      // Test commands can themselves write files, so the edit timestamp is
      // independent of whether the host confirmed success.
      const { lastEditAt, ...verification } = read(handoff);
      return [verification, ...[tracker, contract, evidence].map(read)];
    }
    const snapshots = evidenceSnapshot();

    for (const ambiguous of [
      undefined, null, [], { stdout: { exitCode: 0 } }, { exitCode: '0' },
      { success: true }, 'Process exited with code 0\nOutput:\nanything',
    ]) {
      post(ambiguous);
      assert.deepEqual(evidenceSnapshot(), snapshots);
    }

    post({ exitCode: 0, stderr: 'benign test warning' });
    assert.equal(read(handoff).status, 'idle');
    assert.ok(read(handoff).lastVerifyAt > 0);
    assert.equal(read(tracker).count, 0);
    assert.equal(read(contract).status, 'pass');

    const priorEdit = read(handoff).lastEditAt;
    const edits = hook('PostToolUse', 'state-persist.js', {
      tool_name: 'Bash', tool_input: { command: 'echo changed > generated.txt' },
      tool_response: 'opaque',
    });
    assert.equal(edits.stdout, '');
    assert.ok(read(handoff).lastEditAt > priorEdit);

    const { inferOutcome } = require(path.join(layout, 'hooks/scripts/codex-action-gate-post.js'));
    assert.equal(inferOutcome({ ...shell, tool_response: 'done' }), 'unknown');
    assert.equal(inferOutcome({ ...shell, tool_response: { stderr: 'error' } }), 'unknown');
    assert.equal(inferOutcome({ ...shell, tool_response: { exitCode: 0, isError: true } }), 'failure');
    assert.equal(inferOutcome({ tool_name: 'mcp__repo__update', tool_response: { isError: false } }), 'success');

    const tool_use_id = 'gated-mcp-result';
    const gated = {
      host: 'codex', tool_use_id, tool_name: 'mcp__codex_apps__github__update_pull_request',
      tool_input: { repository_full_name: 'example/repo', pr_number: 7, body: 'test fixture' },
    };
    hook('PreToolUse', 'codex-action-gate-pre.js', gated);
    const audit = path.join(session, 'action-gate', tool_use_id + '.json');
    hook('PostToolUse', 'codex-action-gate-post.js', { ...gated, tool_response: 'opaque' });
    assert.equal(read(audit).executionOutcome, 'unknown');
    hook('PostToolUse', 'codex-action-gate-post.js', { ...gated, tool_response: { exitCode: 1 } });
    assert.equal(read(audit).executionOutcome, 'failure');
    hook('PostToolUse', 'codex-action-gate-post.js', { ...gated, tool_response: 'opaque' });
    assert.equal(read(audit).executionOutcome, 'failure');

    const worker = { agent_id: 'worker-1', agent_type: 'default' };
    hook('SubagentStart', 'subagent-start.js', worker);
    const clean = hook('SubagentStop', 'subagent-stop.js', worker);
    assert.equal(clean.stdout, '');
    assert.equal(clean.stderr, '');
    fs.writeFileSync(path.join(cwd, 'unexpected.txt'), 'change\n');
    const changed = hook('SubagentStop', 'subagent-stop.js', worker);
    const warning = JSON.parse(changed.stdout);
    assert.deepEqual(Object.keys(warning), ['systemMessage']);
    assert.match(warning.systemMessage, /unexpected\.txt/);
    assert.equal(changed.stderr, '');
    const scopeAudit = path.join(session, 'subagent-scope-last.json');
    assert.equal(read(scopeAudit).outOfScope.length, 1);
    assert.equal(hook('SubagentStop', 'subagent-stop.js', worker).stdout, '');
    assert.deepEqual(read(scopeAudit).outOfScope, []);
    assert.equal(fs.readFileSync(path.join(cwd, 'unexpected.txt'), 'utf8'), 'change\n');
    console.log('PASS Codex ' + label + ' outcome and advisory SubagentStop contracts');
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
