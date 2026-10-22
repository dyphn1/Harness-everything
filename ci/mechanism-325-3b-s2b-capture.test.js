#!/usr/bin/env node
'use strict';

// R2c-1 (#325 3b S2b RED part 1): capture + origin provider.
//
// Binding spec at the time of writing: docs/doc-workflow-reconciliation.md
// § S2b — "Activation and pilot-only scope", "Claude capture and
// origin-provider contract", "Retained live-capture gate"; owner decisions in
// dyphn1/Harness-everything#325 (issuecomment-6312323110), rows 1 and 2.
//
// Contract of this suite:
// - Every assertion runs on both legs (canonical hooks/scripts and the
//   packaged plugins/harness-everything copy). Missing S2b modules or exports
//   are FAIL with a module-missing/export-missing reason; the harness never
//   crashes; INFRA is reserved for fixture/subprocess faults.
// - Items 1 (OFF) and the fail-open control drive the real state-persist.js
//   script per leg; items 3–6 bind the future S2b origin provider module
//   through the S2a resolveContext/resolveEvent seam contract.
// - Exit codes: 1 if any assertion failed (expected at RED for
//   missing-implementation reasons only); 0 only when every assertion passes.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./fixtures/doc-obligations/reconciliation-s2b/capture/harness');
const { DISTRIBUTIONS } = require('./lib/doc-reconciliation-prep-fixtures');

const PILOT_SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const PROVIDER_REQ = [{ file: 'doc-reconciliation-provider.js', exports: ['createClaudeOriginProvider'] }];

const runner = H.createRunner('R2c-1 S2b capture/provider');
const GOLDEN = H.golden();

function legacyGoldenChecks(id, drive) {
  if (drive.code !== 0) throw new Error(`state-persist exited ${drive.code}: ${(drive.stderr || drive.stdout).slice(0, 200)}`);
  const names = Object.keys(drive.files);
  for (const rel of names) {
    if (!rel.endsWith('/handoff-state.json')) throw new Error(`OFF created an unexpected session file: ${rel}`);
  }
  const handoffRels = names.filter(rel => rel.endsWith('/handoff-state.json'));
  if (handoffRels.length !== 1) throw new Error(`OFF expected exactly one handoff-state.json, got ${handoffRels.length}`);
  const state = JSON.parse(drive.files[handoffRels[0]]);
  const keys = Object.keys(state).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...GOLDEN.keys].sort())) {
    throw new Error(`OFF handoff keyset changed: got ${JSON.stringify(keys)} expected ${JSON.stringify(GOLDEN.keys)}`);
  }
  for (const [key, expected] of Object.entries(GOLDEN.values)) {
    if (state[key] !== expected) throw new Error(`OFF handoff ${key} changed: got ${state[key]} expected ${expected}`);
  }
  const captures = H.findCaptureRecords(drive.files);
  if (captures.length) throw new Error(`OFF wrote a pilot capture record despite the switch being off: ${JSON.stringify(captures[0]).slice(0, 200)}`);
}

// F8 routes are capture-only when OFF. Drive the real source/package hook with
// an isolated state home and a preload spy that records eager internal imports.
const CAPTURE_ONLY_ROUTES = [
  { id: 'pre-bash', event: 'PreToolUse', tool: 'Bash', input: { command: 'echo f8-probe' } },
  { id: 'pre-powershell', event: 'PreToolUse', tool: 'PowerShell', input: { command: 'Write-Output f8-probe' } },
  { id: 'pre-task', event: 'PreToolUse', tool: 'Task', input: { description: 'F8 capture probe' } },
  { id: 'pre-agent', event: 'PreToolUse', tool: 'Agent', input: { description: 'F8 capture probe' } },
  { id: 'post-task', event: 'PostToolUse', tool: 'Task', input: { description: 'F8 capture probe' } },
  { id: 'post-agent', event: 'PostToolUse', tool: 'Agent', input: { description: 'F8 capture probe' } },
  { id: 'subagent-start', event: 'SubagentStart' },
  { id: 'subagent-stop', event: 'SubagentStop' },
];
const OFF_SWITCH_VALUES = [
  { id: 'unset' },
  { id: 'zero', value: '0' },
  { id: 'other', value: 'true' },
];
const OFF_INTERNAL_REQUIRES = ['./lib/harness-state', './lib/workflow-isolation', './lib/telemetry'];

function snapshotTree(root) {
  const files = {};
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (entry.isFile()) files[path.relative(root, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
    }
  }
  visit(root);
  return files;
}

function captureEventRecords(files) {
  return Object.entries(files)
    .filter(([name]) => /(?:^|\/)doc-reconciliation-capture\/\d{8}\.json$/.test(name))
    .map(([, content]) => JSON.parse(content));
}

function driveCaptureOnlyRoute(leg, route, switchSetting) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-f8-capture-'));
  const stateHome = path.join(temp, 'state-home');
  const wsRoot = path.join(temp, 'workspace');
  const spyPath = path.join(temp, 'load-spy.js');
  const spyLog = path.join(temp, 'loaded-modules.txt');
  fs.mkdirSync(stateHome, { recursive: true });
  fs.mkdirSync(wsRoot, { recursive: true });

  const sessionId = 'f8-' + route.id;
  const payload = {
    hook_event_name: route.event,
    session_id: sessionId,
    cwd: wsRoot,
  };
  if (route.tool) {
    payload.tool_name = route.tool;
    payload.tool_use_id = 'toolu-' + route.id;
    payload.tool_input = route.input;
    if (route.event === 'PostToolUse') {
      payload.tool_response = { agentId: 'agent-f8', interrupted: false, result: 'completed' };
    }
  }
  if (route.event === 'SubagentStart' || route.event === 'SubagentStop') {
    payload.agent_id = 'agent-f8';
    payload.agent_type = 'doc-reviewer';
  }
  if (route.event === 'SubagentStop') {
    payload.last_assistant_message = 'Review verdict: approve. F8 capture probe.';
  }

  const spySource = [
    "const fs = require('node:fs');",
    "const Module = require('node:module');",
    'const logPath = ' + JSON.stringify(spyLog) + ';',
    'const watched = new Set(' + JSON.stringify(OFF_INTERNAL_REQUIRES) + ');',
    'const originalLoad = Module._load;',
    'Module._load = function(request, parent, isMain) {',
    '  if (watched.has(request)) fs.appendFileSync(logPath, request + String.fromCharCode(10));',
    '  return originalLoad.call(this, request, parent, isMain);',
    '};',
  ].join('\n');
  fs.writeFileSync(spyPath, spySource, 'utf8');

  const env = {
    ...process.env,
    CLAUDE: '1',
    HOME: temp,
    USERPROFILE: temp,
    HARNESS_STATE_HOME: stateHome,
    HARNESS_WORKSPACE_ROOT: wsRoot,
  };
  delete env.NODE_OPTIONS;
  if (switchSetting.value === undefined) delete env[PILOT_SWITCH];
  else env[PILOT_SWITCH] = switchSetting.value;

  try {
    const result = spawnSync(process.execPath, ['--require', spyPath, path.join(leg.hooksScripts, 'state-persist.js')], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      cwd: wsRoot,
      env,
      timeout: 30000,
    });
    if (result.error) throw new H.InfraError('capture-only hook subprocess failed: ' + result.error.message);
    return {
      code: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      files: snapshotTree(stateHome),
      loadedModules: fs.existsSync(spyLog) ? fs.readFileSync(spyLog, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [],
      payload,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

runner.run('R2C1-OFF-CAPTURE-ONLY-FAST-PATH', [], (_mods, leg) => {
  const routeSwitchCases = CAPTURE_ONLY_ROUTES.length * OFF_SWITCH_VALUES.length;
  let preloadCases = 0;
  let stateChangeCases = 0;
  let outputCases = 0;
  let captureCases = 0;
  let badExitCases = 0;
  const loadedModules = new Set();
  for (const route of CAPTURE_ONLY_ROUTES) {
    for (const switchSetting of OFF_SWITCH_VALUES) {
      const result = driveCaptureOnlyRoute(leg, route, switchSetting);
      if (result.loadedModules.length) {
        preloadCases += 1;
        result.loadedModules.forEach(name => loadedModules.add(name));
      }
      if (result.code !== 0) badExitCases += 1;
      if (result.stdout || result.stderr) outputCases += 1;
      if (Object.keys(result.files).length) stateChangeCases += 1;
      if (captureEventRecords(result.files).length) captureCases += 1;
    }
  }
  const failures = [];
  if (preloadCases) failures.push('preload-spy RED: internal modules loaded in ' + preloadCases + '/' + routeSwitchCases + ' OFF route/switch cases (' + [...loadedModules].join(', ') + ')');
  if (badExitCases) failures.push('nonzero exit in ' + badExitCases + '/' + routeSwitchCases + ' OFF cases');
  if (outputCases) failures.push('output emitted in ' + outputCases + '/' + routeSwitchCases + ' OFF cases');
  if (stateChangeCases) failures.push('state changed in ' + stateChangeCases + '/' + routeSwitchCases + ' OFF cases');
  if (captureCases) failures.push('capture written in ' + captureCases + '/' + routeSwitchCases + ' OFF cases');
  if (failures.length) throw new Error(failures.join('; '));
});

runner.run('R2C1-ON-CAPTURE-ONLY-ROUTES', [], (_mods, leg) => {
  const failures = [];
  for (const route of CAPTURE_ONLY_ROUTES) {
    const result = driveCaptureOnlyRoute(leg, route, { value: '1' });
    if (result.code !== 0) { failures.push(route.id + ': exit ' + result.code); continue; }
    if (result.stdout || result.stderr) failures.push(route.id + ': output emitted');
    const record = captureEventRecords(result.files).find(item => item.event === route.event
      && item.session_id === result.payload.session_id
      && (!route.tool || item.tool_name === route.tool)
      && (!result.payload.tool_use_id || item.tool_use_id === result.payload.tool_use_id));
    if (!record) failures.push(route.id + ': ON capture missing');
    else {
      if (record.cwd !== result.payload.cwd) failures.push(route.id + ': cwd mismatch');
      if (!/^[0-9a-f]{64}$/.test(String(record.responseDigest))) failures.push(route.id + ': response digest missing');
      if (!record.captureId || !record.responseRef) failures.push(route.id + ': capture identity missing');
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
});

// ---- Item 1: OFF must write no capture and keep legacy state identical --------

runner.run('R2C1-OFF-UNSET', [], (_mods, leg) => {
  legacyGoldenChecks('R2C1-OFF-UNSET', H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}));
});

runner.run('R2C1-OFF-ZERO', [], (_mods, leg) => {
  legacyGoldenChecks('R2C1-OFF-ZERO', H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}, { env: { [PILOT_SWITCH]: '0' } }));
});

runner.run('R2C1-OFF-OTHER-VALUE', [], (_mods, leg) => {
  // "other values" beyond unset/0 must behave OFF: only the exact value `1`
  // establishes the ON + supported decision (doc lines 833–838, 1005–1006).
  legacyGoldenChecks('R2C1-OFF-OTHER-VALUE', H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}, { env: { [PILOT_SWITCH]: 'true' } }));
});

// ---- Item 2: ON capture, exact doc fields, absent fields absent, fail-open ----

runner.run('R2C1-ON-CAPTURE-POSTTOOLUSE', [], (_mods, leg) => {
  const drive = H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}, { env: { [PILOT_SWITCH]: '1' } });
  if (drive.code !== 0) throw new Error(`state-persist exited ${drive.code}: ${(drive.stderr || drive.stdout).slice(0, 200)}`);
  const source = H.payload('payload-post-tool-use-success.json');
  const records = H.findCaptureRecords(drive.files);
  if (!records.length) throw new Error('ON PostToolUse wrote no pilot capture record (no qualifying file in the session subtree)');
  const matching = records.filter(r => r.event === 'PostToolUse' && r.tool_use_id === source.tool_use_id);
  if (!matching.length) throw new Error(`ON PostToolUse capture missing for tool_use_id ${source.tool_use_id}`);
  for (const record of matching) H.assertCaptureRecordShape(record, drive.payload);
});

runner.run('R2C1-ON-CAPTURE-OPTIONAL-ABSENT', [], (_mods, leg) => {
  const drive = H.driveStatePersist(leg, 'payload-post-tool-use-success-minimal.json', {}, { env: { [PILOT_SWITCH]: '1' } });
  const source = H.payload('payload-post-tool-use-success-minimal.json');
  const records = H.findCaptureRecords(drive.files).filter(r => r.event === 'PostToolUse' && r.tool_use_id === source.tool_use_id);
  if (!records.length) throw new Error('ON minimal PostToolUse wrote no pilot capture record');
  for (const record of records) H.assertCaptureRecordShape(record, drive.payload); // absent input fields must stay absent
});

runner.run('R2C1-ON-CAPTURE-FAILURE', [], (_mods, leg) => {
  const drive = H.driveStatePersist(leg, 'payload-post-tool-use-failure.json', {}, { env: { [PILOT_SWITCH]: '1' } });
  if (drive.code !== 0) throw new Error(`state-persist exited ${drive.code}: ${(drive.stderr || drive.stdout).slice(0, 200)}`);
  const source = H.payload('payload-post-tool-use-failure.json');
  const records = H.findCaptureRecords(drive.files).filter(r => r.event === 'PostToolUseFailure' && r.tool_use_id === source.tool_use_id);
  if (!records.length) throw new Error('ON PostToolUseFailure wrote no pilot capture record');
  for (const record of records) H.assertCaptureRecordShape(record, drive.payload);
});

runner.run('R2C1-ON-CAPTURE-FAIL-OPEN', [], (_mods, leg) => {
  // A capture (or any hook) failure must never change the hook's exit/output.
  // Today this passes because state-persist already fails open; it must keep
  // passing after the S2b capture wiring lands.
  const drive = H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}, { env: { [PILOT_SWITCH]: '1' } });
  if (drive.code !== 0) throw new Error(`fail-open violated: state-persist exited ${drive.code}`);
  if (/\bThrow\b|at Object|node:internal/.test(drive.stderr)) throw new Error(`fail-open violated: hook crashed with ${drive.stderr.slice(0, 200)}`);
});

// ---- Items 3–6: the S2b origin provider --------------------------------------

function makeProvider(leg, input) {
  const met = H.requirementsMet(leg, PROVIDER_REQ);
  if (met.error) throw new Error(met.error);
  const provider = met.mods['doc-reconciliation-provider.js'].createClaudeOriginProvider(H.providerInput(input));
  if (!provider || typeof provider.resolveEvent !== 'function' || typeof provider.resolveContext !== 'function') {
    throw new Error('createClaudeOriginProvider must return { resolveContext, resolveEvent } implementing the S2a seam');
  }
  return provider;
}

function runProvider(leg, input, reference) {
  const provider = makeProvider(leg, input);
  const response = provider.resolveEvent({ reference, identity: H.providerIdentity() });
  const out = { response, provider, context: provider.resolveContext({ workspaceRoot: H.FIXED.workspaceRoot, workflowId: H.FIXED.workflowId, sessionId: H.FIXED.sessionId }) };
  return out;
}

// No-qualification cases run from an isolated copy of the provider, with no live-capture directory above it. The gate
// outcome then never depends on whether retained live evidence exists in this checkout, so the live capture can land
// without turning these gate-unmet cases into INFRA.
function isolatedRunProvider(leg, input, reference) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c1-isolated-'));
  try {
    const lib = path.join(dir, 'hooks', 'scripts', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.copyFileSync(path.join(leg.lib, 'doc-reconciliation-provider.js'), path.join(lib, 'doc-reconciliation-provider.js'));
    const provider = require(path.join(lib, 'doc-reconciliation-provider.js')).createClaudeOriginProvider(H.providerInput(input));
    const response = provider.resolveEvent({ reference, identity: H.providerIdentity() });
    const context = provider.resolveContext({ workspaceRoot: H.FIXED.workspaceRoot, workflowId: H.FIXED.workflowId, sessionId: H.FIXED.sessionId });
    return { response, provider, context };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertNoExitZeroCredit(out, label) {
  const { response } = out;
  if (response && response.status === 'accepted') {
    if (Number.isInteger(response.event && response.event.exitCode) && response.event.exitCode === 0) {
      throw new Error(`${label}: accepted and mapped exit 0`);
    }
    throw new Error(`${label}: unexpected accepted response ${JSON.stringify(response).slice(0, 200)}`);
  }
  if (!(response && Array.isArray(response.diagnostics) && response.diagnostics.length)) throw new Error(`${label}: ${response && response.status} with no diagnostics`);
}

function captureDiagnosticsText(out) {
  return JSON.stringify([...((out.response && out.response.diagnostics) || []), ...((out.context && out.context.diagnostics) || [])]);
}

runner.run('R2C1-EXIT-MAPPING-SUCCESS', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (!out.response || out.response.status !== 'accepted') {
    throw new Error(`success event not accepted: ${out.response ? out.response.status : 'no response'} ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
  const event = out.response.event;
  if (!Number.isInteger(event.exitCode) || event.exitCode !== 0) throw new Error(`owner decision 1: expected integer exit 0, got ${event.exitCode}`);
  if (event.signal !== null) throw new Error(`owner decision 1: expected signal null, got ${event.signal}`);
  if (event.toolCorrelationId !== 'toolu_r2c1_a') throw new Error(`toolCorrelationId mismatch: ${event.toolCorrelationId}`);
  if (event.command !== H.payload('payload-post-tool-use-success.json').tool_input.command) throw new Error(`event command mismatch: ${event.command}`);
  const originRef = out.response.originRef !== undefined ? out.response.originRef : out.context && out.context.originRef;
  if (typeof originRef !== 'string') throw new Error(`accepted event missing originRef binding`);
});

runner.run('R2C1-EXIT-MAPPING-FAILURE-SAME-ID', PROVIDER_REQ, (_mods, leg) => {
  const captures = [
    H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass', toolUseId: 'toolu_r2c1_b' }),
    H.simulateCapture('payload-post-tool-use-failure.json', { ref: 'exec-fail', toolUseId: 'toolu_r2c1_b' }),
  ];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  assertNoExitZeroCredit(out, 'failure for the same tool_use_id must void the success mapping');
});

runner.run('R2C1-EXIT-MAPPING-FAILURE-NEVER-CREDITED', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-failure.json', { ref: 'exec-fail' })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-fail');
  assertNoExitZeroCredit(out, 'PostToolUseFailure is never credited');
});

runner.run('R2C1-EXIT-MAPPING-INTERRUPTED', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass', interrupted: true })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  assertNoExitZeroCredit(out, 'interrupted success must not be mapped to exit 0');
});

runner.run('R2C1-EXIT-MAPPING-MISSING-TOOL-USE-ID', PROVIDER_REQ, (_mods, leg) => {
  const record = H.simulateCapture('payload-post-tool-use-success-minimal.json', { ref: 'exec-pass' });
  delete record.tool_use_id;
  const out = runProvider(leg, { captures: [record], qualification: H.fakeQualification('sim') }, 'exec-pass');
  assertNoExitZeroCredit(out, 'missing tool_use_id must not be credited');
});

// ---- Item 4: reviewer independence via host-issued subagent principal ---------

const REVIEW_REF = 'review-1';
const REVIEW_TEAM_REF = 'review-task-result';

function reviewCaptures(agentIdStop, agentIdTask, opts = {}) {
  return [
    H.simulateCapture('payload-subagent-stop.json', { ref: REVIEW_REF, agentId: agentIdStop }),
    H.simulateCapture('payload-task-result.json', { ref: REVIEW_TEAM_REF, agentId: agentIdTask }),
  ];
}

runner.run('R2C1-REVIEWER-VALID', PROVIDER_REQ, (_mods, leg) => {
  const out = runProvider(leg, { captures: reviewCaptures('agent-r2c1-rev', 'agent-r2c1-rev'), qualification: H.fakeQualification('sim') }, REVIEW_REF);
  if (!out.response || out.response.status !== 'accepted') {
    throw new Error(`independent reviewer event not accepted: ${out.response ? out.response.status : 'no response'} ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
  const event = out.response.event;
  if (event.kind !== 'review') throw new Error(`expected a review event, got kind ${event.kind}`);
  if (event.principalId !== 'agent-r2c1-rev') throw new Error(`reviewer principal must be the host agent_id, got ${event.principalId}`);
  const independentOf = Array.isArray(event.independentOf) ? event.independentOf.map(String) : [];
  for (const required of [H.FIXED.sessionId]) {
    if (!independentOf.includes(required)) throw new Error(`independentOf must include author ${required}: ${JSON.stringify(independentOf)}`);
  }
  if (independentOf.includes('agent-r2c1-rev')) throw new Error(`independentOf must not include the reviewer himself`);
  const blob = JSON.stringify(event);
  const stopRecord = H.simulateCapture('payload-subagent-stop.json', { ref: 'unused' });
  if (!blob.includes(stopRecord.reviewDigest)) throw new Error(`review event lost the bound final review artifact digest ${stopRecord.reviewDigest}`);
});

runner.run('R2C1-REVIEWER-SAME-ID-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  // agent_id identical to the author session id: not independent.
  const out = runProvider(leg, { captures: reviewCaptures(H.FIXED.sessionId, H.FIXED.sessionId), qualification: H.fakeQualification('sim') }, REVIEW_REF);
  assertNoExitZeroCredit(out, 'reviewer equal to author must be rejected');
});

runner.run('R2C1-REVIEWER-EXECUTOR-ID-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  const out = runProvider(leg, {
    captures: reviewCaptures('agent-exec-1', 'agent-exec-1'),
    executorPrincipals: ['agent-exec-1'],
    qualification: H.fakeQualification('sim'),
  }, REVIEW_REF);
  assertNoExitZeroCredit(out, 'reviewer equal to an executor must be rejected');
});

runner.run('R2C1-REVIEWER-SURFACE-INCONSISTENCY-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  // SubagentStop and the Task result name different subagent identities:
  // the surfaces must be consistent or the record is rejected (doc capture table).
  const out = runProvider(leg, { captures: reviewCaptures('agent-r2c1-rev', 'agent-someone-else'), qualification: H.fakeQualification('sim') }, REVIEW_REF);
  assertNoExitZeroCredit(out, 'identity inconsistency between SubagentStop and the Task result must be rejected');
});

runner.run('R2C1-REVIEWER-REPLAY-COPIED-REJECTED', PROVIDER_REQ, (_mods, leg) => {
  // Same host event content re-presented under a new reference/captureId:
  // the fresh first resolution stays accepted, the copied second is rejected.
  const first = H.simulateCapture('payload-subagent-stop.json', { ref: REVIEW_REF });
  const replay = H.simulateCapture('payload-subagent-stop.json', { ref: 'review-replay' });
  replay.reviewDigest = first.reviewDigest;
  // F4-T5 conflict 3: the review needs its correlated Agent/Task result surface, delivered with the original.
  const task = H.simulateCapture('payload-task-result.json', { ref: REVIEW_TEAM_REF, agentId: 'agent-r2c1-rev' });
  const provider = makeProvider(leg, { captures: [first, task, replay], qualification: H.fakeQualification('sim') });
  const firstResponse = provider.resolveEvent({ reference: REVIEW_REF, identity: H.providerIdentity() });
  if (!firstResponse || firstResponse.status !== 'accepted') {
    throw new Error(`copy test needs the original to be accepted first; got ${(firstResponse && firstResponse.status) || 'none'} ${JSON.stringify((firstResponse && firstResponse.diagnostics) || []).slice(0, 200)}`);
  }
  const replayResponse = provider.resolveEvent({ reference: 'review-replay', identity: H.providerIdentity() });
  if (replayResponse && replayResponse.status === 'accepted') {
    throw new Error('copied/replayed record was accepted under a new reference');
  }
});

// F4-T5 conflict 1: a reviewer that ran a registered doc-check is an executor, so its review is refused. Its plain tool
// use is not execution evidence, so the same review stays accepted (the control keeps the refusal from being vacuous).
runner.run('R2C1-REVIEWER-RAN-EVIDENCE-REFUSED', PROVIDER_REQ, (_mods, leg) => {
  const plain = H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-plain', agentId: 'agent-r2c1-rev' });
  const control = runProvider(leg, { captures: [plain, ...reviewCaptures('agent-r2c1-rev', 'agent-r2c1-rev')], qualification: H.fakeQualification('sim') }, REVIEW_REF);
  if (!control.response || control.response.status !== 'accepted') {
    throw new Error(`control: a reviewer's plain tool use must not refuse the review; got ${control.response ? control.response.status : 'no response'}`);
  }
  const run = H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass', agentId: 'agent-r2c1-rev' });
  run.command = `node ${DISTRIBUTIONS[leg.name].docCheck} check --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/a.md`;
  const out = runProvider(leg, { captures: [run, ...reviewCaptures('agent-r2c1-rev', 'agent-r2c1-rev')], qualification: H.fakeQualification('sim') }, REVIEW_REF);
  if (!out.response || out.response.status === 'accepted') throw new Error('reviewer that ran the registered check was accepted as independent');
  if (!captureDiagnosticsText(out).includes('reviewer-not-independent')) throw new Error(`refused for another reason: ${captureDiagnosticsText(out).slice(0, 200)}`);
});

// A labelled `Review verdict: reject` never approves, and neither does free text that only says REJECT. Both are
// fixtures on the independent reviewer surface, so only the verdict line decides the outcome.
for (const [id, fixture] of [
  ['R2C1-REVIEWER-REJECT-NEVER-APPROVES', 'payload-subagent-stop-reject.json'],
  ['R2C1-REVIEWER-FREETEXT-REJECT-NEVER-APPROVES', 'payload-subagent-stop-freetext-reject.json'],
]) {
  runner.run(id, PROVIDER_REQ, (_mods, leg) => {
    const captures = [H.simulateCapture(fixture, { ref: REVIEW_REF, agentId: 'agent-r2c1-rev' }), H.simulateCapture('payload-task-result.json', { ref: REVIEW_TEAM_REF, agentId: 'agent-r2c1-rev' })];
    const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, REVIEW_REF);
    assertNoExitZeroCredit(out, `${fixture} must never approve`);
  });
}

// ---- Item 5: unsupported hosts are unavailable and never borrow Claude mapping

runner.run('R2C1-UNSUPPORTED-OPENCODE', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = runProvider(leg, { hostId: 'opencode', captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (out.response && out.response.status === 'accepted') throw new Error('opencode must not be accepted');
  if (out.context && out.context.status === 'accepted') throw new Error('opencode resolveContext must be unavailable');
  if (!(out.response && out.response.status === 'unavailable' && out.context && out.context.status === 'unavailable')) {
    throw new Error(`expected provider unavailable, got response=${out.response && out.response.status} context=${out.context && out.context.status}`);
  }
  if (JSON.stringify(captureDiagnosticsText(out)).length < 4) throw new Error('unavailable response carried no diagnostics');
});

runner.run('R2C1-UNSUPPORTED-CODEX', PROVIDER_REQ, (_mods, leg) => {
  // Codex-shaped capture including a numeric exit on the record: the provider
  // must stay unavailable and must not credit that numeric exit via any path.
  const capture = H.simulateCapture('payload-post-tool-use-failure.json', { ref: 'exec-pass' });
  capture.capturedExitCode = 2;
  const out = runProvider(leg, { hostId: 'codex', captures: [capture], qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (out.response && out.response.status !== 'unavailable') throw new Error(`codex expected unavailable, got ${(out.response && out.response.status)}`);
  if (out.context && out.context.status === 'accepted') throw new Error('codex resolveContext must be unavailable');
});

// ---- Item 6: retained live-capture gate disabling positive credit -------------

runner.run('R2C1-LIVE-GATE-UNMET', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = isolatedRunProvider(leg, { captures }, 'exec-pass'); // no qualification, isolated: production retained-evidence path
  if (out.response && out.response.status === 'accepted') throw new Error('positive credit granted while the retained live gate is unmet');
  if (!/live[- ]?gate|qualification/i.test(captureDiagnosticsText(out))) {
    throw new Error(`gate-unmet response must say why: ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
});

runner.run('R2C1-LIVE-GATE-DI-QUALIFICATION-OPENS', PROVIDER_REQ, (_mods, leg) => {
  const captures = [H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' })];
  const out = runProvider(leg, { captures, qualification: H.fakeQualification('sim') }, 'exec-pass');
  if (!out.response || out.response.status !== 'accepted') {
    throw new Error(`every otherwise-valid simulated event must resolve under an explicitly fake DI qualification: ${captureDiagnosticsText(out).slice(0, 200)}`);
  }
});

runner.run('R2C1-LIVE-GATE-NO-ENV-OR-FLAG-BYPASS', PROVIDER_REQ, (_mods, leg) => {
  const capture = H.simulateCapture('payload-post-tool-use-success.json', { ref: 'exec-pass' });
  capture.trusted = true;
  // The host switch and a self-declared `trusted` capture flag must not open
  // the gate: qualification resolves only from retained live evidence (DI
  // excepted for tests).
  const previous = process.env[PILOT_SWITCH];
  process.env[PILOT_SWITCH] = '1';
  try {
    const out = isolatedRunProvider(leg, { captures: [capture] }, 'exec-pass'); // no DI qualification, isolated
    if (out.response && out.response.status === 'accepted') {
      throw new Error('live gate was bypassed by env toggle/record flag (must stay unmet without retained evidence)');
    }
    if (out.context && out.context.status === 'accepted') {
      throw new Error('live gate was bypassed at resolveContext by env toggle/record flag');
    }
  } finally {
    if (previous === undefined) delete process.env[PILOT_SWITCH];
    else process.env[PILOT_SWITCH] = previous;
  }
});

// ---- Item 7: Claude manifest declares SubagentStart/SubagentStop ---------------

runner.run('R2C1-MANIFEST-SUBAGENT-HOOKS', [], (_mods, leg) => {
  const manifest = JSON.parse(fs.readFileSync(leg.hooksManifest, 'utf8'));
  const hooks = (manifest && manifest.hooks) || {};
  if (leg.name === 'source') {
    // The source manifest is Claude's capture surface; the packaged Codex plugin
    // keeps its own host-specific SubagentStart/Stop adapters below.
    const hasStatePersist = group => ((group && group.hooks) || []).some(handler =>
      handler.type === 'command' && /state-persist\.js/.test(handler.command || ''));
    for (const route of [
      { event: 'PreToolUse', matcher: 'Bash|PowerShell|Task|Agent' },
      { event: 'PostToolUse', matcher: 'Task|Agent' },
      { event: 'SubagentStart' },
      { event: 'SubagentStop' },
    ]) {
      const groups = hooks[route.event];
      if (!Array.isArray(groups) || !groups.some(group => group.matcher === route.matcher && hasStatePersist(group))) {
        throw new Error(route.event + ' state-persist route is missing or narrowed');
      }
    }
  }
  for (const event of ['SubagentStart', 'SubagentStop']) {
    const groups = hooks[event];
    if (!Array.isArray(groups) || !groups.length) throw new Error(`hooks/hooks.json does not declare ${event}`);
    for (const group of groups) {
      const handlers = (group && group.hooks) || [];
      if (!handlers.length) throw new Error(`${event} matcher group has no handlers`);
      for (const handler of handlers) {
        if (handler.type !== 'command') throw new Error(`${event} handler must be a command hook, got ${handler.type}`);
      }
    }
  }
});

// ---- Summary ------------------------------------------------------------------

function finish(counts) {
  if (counts.FAIL === 0 && counts.INFRA === 0) {
    console.log('R2c-1 suite: all assertions PASS.');
    process.exit(0);
  }
  console.log(`R2c-1 suite: FAIL/INFRA present (expected at RED: ${counts.FAIL}, infra faults: ${counts.INFRA}).`);
  process.exit(1);
}

finish(runner.summary());
