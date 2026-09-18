#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const telemetry = require(path.join(ROOT, 'hooks/scripts/lib/telemetry.js'));
const { buildReport } = require(path.join(ROOT, 'telemetry/scripts/report.js'));
const { runBenchmark } = require(path.join(ROOT, 'telemetry/scripts/benchmark.js'));

let failed = 0;
function check(condition, message, detail = '') {
  if (condition) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}${detail ? ` (${detail})` : ''}`); failed++; }
}
function run(script, payload, cwd, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_TELEMETRY: 'local', ...env },
  });
}

async function main() {
  console.log('=== Cross-Agent Telemetry (#83) ===');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-telemetry-test-'));
  const workspace = path.join(temp, 'workspace');
  const stateHome = path.join(temp, 'state-home');
  fs.mkdirSync(workspace, { recursive: true });
  const git = spawnSync('git', ['init'], { cwd: workspace, encoding: 'utf8' });
  check(git.status === 0, 'telemetry fixture initializes git workspace', git.stderr);

  const priorHome = process.env.HARNESS_STATE_HOME;
  const priorTelemetry = process.env.HARNESS_TELEMETRY;
  process.env.HARNESS_STATE_HOME = stateHome;
  process.env.HARNESS_TELEMETRY = 'local';

  try {
    const session = 'raw-session-id-must-be-hashed';
    const secret = 'SECRET_TOOL_ARGUMENT_MUST_NOT_APPEAR';
    const base = {
      session_id: session,
      cwd: workspace,
      tool_name: 'Skill',
      tool_use_id: 'skill-call-1',
      tool_input: { name: 'tdd', hidden: secret },
    };

    const pre = run('hooks/scripts/telemetry-adapter.js', { ...base, hook_event_name: 'PreToolUse' }, workspace, {
      HARNESS_STATE_HOME: stateHome,
    });
    check(pre.status === 0, 'Claude-compatible skill pre hook is fail-open', pre.stderr);

    const post = run('hooks/scripts/telemetry-adapter.js', {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_response: { exitCode: 0, stdout: secret },
    }, workspace, { HARNESS_STATE_HOME: stateHome });
    check(post.status === 0, 'Claude-compatible skill post hook is fail-open', post.stderr);

    const tool = run('hooks/scripts/state-persist.js', {
      session_id: session,
      cwd: workspace,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'tool-call-1',
      tool_input: { command: `echo ${secret}` },
      tool_response: { exitCode: 0, duration_ms: 12.5, stdout: secret },
    }, workspace, { HARNESS_STATE_HOME: stateHome });
    check(tool.status === 0, 'existing state-persist hook remains successful with telemetry observer', tool.stderr);

    const stop = run('hooks/scripts/telemetry-adapter.js', {
      session_id: session,
      cwd: workspace,
      hook_event_name: 'Stop',
    }, workspace, { HARNESS_STATE_HOME: stateHome });
    check(stop.status === 0, 'Stop closes active telemetry window without gating task', stop.stderr);

    const file = telemetry.telemetryFile(workspace, { cwd: workspace });
    const events = telemetry.readEvents(file);
    check(events.length === 4, 'skill invoke/load, tool observation, and completion are retained as four normalized events');
    check(events.every(event => !event.invalid), 'all retained JSONL events satisfy the normalized event contract');
    check(events.every(event => event.sessionId !== session && /^session-[a-f0-9]{16}$/.test(event.sessionId)), 'raw host session identity is replaced by local hash');
    const serialized = fs.readFileSync(file, 'utf8');
    check(!serialized.includes(secret), 'telemetry never stores prompt/tool argument/output secret fixture');
    check(!serialized.includes(workspace), 'telemetry never stores absolute workspace paths');
    check(!serialized.includes('command'), 'telemetry event payload has no raw command field');

    const toolEvent = events.find(event => event.event === 'tool.observed');
    check(toolEvent?.timing?.attributedToolDurationMs === 12.5, 'host-provided tool duration is attributed separately while skill is active');
    const complete = events.find(event => event.event === 'skill.complete');
    check(Number.isFinite(complete?.timing?.activeWindowMs), 'active window is recorded independently from skill load/tool time');
    check(Number.isFinite(events.find(event => event.event === 'skill.loaded')?.timing?.skillLoadDurationMs), 'skill load duration has its own metric');

    const report = buildReport(events);
    check(report.skills.length === 1 && report.skills[0].skillName === 'tdd', 'aggregation groups events by host/skill');
    check(report.skills[0].invocationCount === 1 && report.skills[0].toolEventCount === 1, 'aggregation retains invocation and attributed-tool counts');
    check(report.semantics.activeWindowMs.includes('not CPU'), 'report documents active-window semantics instead of calling it runtime');

    const forbidden = telemetry.emitTelemetry({
      event: 'skill.invoke',
      host: 'claude',
      prompt: 'must never be accepted',
    }, { file: path.join(temp, 'forbidden.jsonl') });
    check(forbidden.ok === false && /forbidden/.test(forbidden.error), 'privacy contract rejects forbidden content-bearing fields');

    const impossibleParent = path.join(temp, 'parent-is-file');
    fs.writeFileSync(impossibleParent, 'x', 'utf8');
    const storageFailure = telemetry.emitTelemetry({
      event: 'skill.invoke',
      host: 'claude',
      sessionId: 'session-test',
      invocationId: 'invocation-test',
      skillName: 'tdd',
    }, { file: path.join(impossibleParent, 'events.jsonl') });
    check(storageFailure.ok === false, 'telemetry storage failure is returned as observability failure rather than throwing');

    process.env.HARNESS_TELEMETRY = 'off';
    const beforeDisabled = fs.statSync(file).size;
    const disabled = telemetry.emitTelemetry({
      event: 'skill.invoke', host: 'claude', skillName: 'tdd',
    }, { file });
    check(disabled.ok === true && disabled.disabled === true && fs.statSync(file).size === beforeDisabled, 'telemetry can be locally disabled without task failure');
    process.env.HARNESS_TELEMETRY = 'local';

    // OpenCode: use the real plugin hooks. No extra process is spawned for
    // per-tool timing; before/after timestamps live inside the plugin process.
    const skillDir = path.join(workspace, '.claude', 'skills', 'tdd');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: tdd\nmetadata:\n  version: 9.9.9\n---\n', 'utf8');
    const pluginUrl = pathToFileURL(path.join(ROOT, 'opencode-plugin', 'index.mjs')).href + `?telemetry=${Date.now()}`;
    const { HarnessEnforcement } = await import(pluginUrl);
    const hooks = await HarnessEnforcement({
      directory: workspace,
      client: { session: { prompt: async () => {} } },
    });
    await hooks['tool.execute.before']({ tool: 'skill', sessionID: 'oc-session', callID: 'oc-skill-1', args: { name: 'tdd', secret } }, {});
    await hooks['tool.execute.after']({ tool: 'skill', sessionID: 'oc-session', callID: 'oc-skill-1', args: { name: 'tdd' } }, {});
    await hooks['tool.execute.before']({ tool: 'bash', sessionID: 'oc-session', callID: 'oc-tool-1', args: { command: secret } }, {});
    await new Promise(resolve => setTimeout(resolve, 2));
    await hooks['tool.execute.after']({ tool: 'bash', sessionID: 'oc-session', callID: 'oc-tool-1', args: { command: secret } }, {});
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc-session' } } });

    const allEvents = telemetry.readEvents(file);
    const ocEvents = allEvents.filter(event => event.host === 'opencode');
    check(ocEvents.some(event => event.event === 'skill.invoke') && ocEvents.some(event => event.event === 'skill.complete'), 'real OpenCode plugin emits skill invocation and turn-boundary completion events');
    check(ocEvents.some(event => event.event === 'tool.observed' && Number.isFinite(event.timing.attributedToolDurationMs)), 'OpenCode adapter measures in-process tool duration while skill is active');
    check(ocEvents.some(event => event.skillVersion === '9.9.9'), 'OpenCode adapter records locally resolved skill version without storing skill-file path');
    check(!fs.readFileSync(file, 'utf8').includes(secret), 'OpenCode telemetry also excludes raw tool arguments');

    const benchmark = runBenchmark(120);
    check(Number.isFinite(benchmark.p50Ms) && Number.isFinite(benchmark.p95Ms) && benchmark.count === 120, 'instrumentation benchmark measures local append overhead');
    console.log(`  INFO telemetry local sink overhead: p50=${benchmark.p50Ms.toFixed(3)}ms p95=${benchmark.p95Ms.toFixed(3)}ms max=${benchmark.maxMs.toFixed(3)}ms`);

    const sourceHooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
    const pluginHooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/harness-everything/hooks/hooks.json'), 'utf8'));
    check(sourceHooks.hooks.PreToolUse.some(group => group.matcher === 'Skill' && group.id === 'harness:pre:skill-telemetry'), 'Claude manifest wires narrow Skill pre telemetry hook');
    check(sourceHooks.hooks.Stop.some(group => group.id === 'harness:stop:skill-telemetry'), 'Claude manifest closes active windows at Stop');
    check(pluginHooks.hooks.PreToolUse.some(group => group.matcher === 'Skill' && group.hooks.some(h => /telemetry-adapter/.test(h.command))), 'OpenAI package contains mechanism-level Skill telemetry adapter');
    check(!pluginHooks.hooks.PostToolUseFailure, 'Codex package does not invent unsupported PostToolUseFailure telemetry');

    for (const [canonical, mirror] of [
      ['hooks/scripts/lib/telemetry.js', 'plugins/harness-everything/hooks/scripts/lib/telemetry.js'],
      ['hooks/scripts/telemetry-adapter.js', 'plugins/harness-everything/hooks/scripts/telemetry-adapter.js'],
      ['hooks/scripts/state-persist.js', 'plugins/harness-everything/hooks/scripts/state-persist.js'],
    ]) {
      check(fs.readFileSync(path.join(ROOT, canonical), 'utf8') === fs.readFileSync(path.join(ROOT, mirror), 'utf8'), `plugin mirror matches canonical: ${canonical}`);
    }

    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'telemetry/schemas/event.schema.json'), 'utf8'));
    check(schema.properties?.timing?.properties?.activeWindowMs && schema.properties?.event?.enum?.includes('tool.observed'), 'versioned telemetry schema preserves separate timing vocabulary');

  } finally {
    if (priorHome === undefined) delete process.env.HARNESS_STATE_HOME;
    else process.env.HARNESS_STATE_HOME = priorHome;
    if (priorTelemetry === undefined) delete process.env.HARNESS_TELEMETRY;
    else process.env.HARNESS_TELEMETRY = priorTelemetry;
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: #83 cross-agent telemetry (${failed} failure${failed === 1 ? '' : 's'})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
