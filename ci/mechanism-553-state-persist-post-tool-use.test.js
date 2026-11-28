#!/usr/bin/env node
'use strict';

// General state-persist PostToolUse compatibility controls, moved here from the
// S2b capture/provider suite when the E1 pilot was retired (issue #553, T2-H).
// These are ordinary state-persist outcomes: retired manifest callbacks stay
// quiet, the legacy handoff golden survives unset/0/unknown flag values, and
// ordinary success/failure posts do not depend on the retired pilot switch.
//
// Every assertion runs on both legs (canonical hooks/scripts and the packaged
// plugins/harness-everything copy) against the real state-persist.js entry.
// This suite does not require any E1 runtime module at load time.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./fixtures/state-persist-post-tool-use/harness');

const ROOT = path.resolve(__dirname, '..');
const PILOT_SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';

const runner = H.createRunner('state-persist PostToolUse');
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
    throw new Error(`legacy handoff keyset changed: got ${JSON.stringify(keys)} expected ${JSON.stringify(GOLDEN.keys)}`);
  }
  for (const [key, expected] of Object.entries(GOLDEN.values)) {
    if (state[key] !== expected) throw new Error(`legacy handoff ${key} changed: got ${state[key]} expected ${expected}`);
  }
  const captures = H.findCaptureRecords(drive.files);
  if (captures.length) throw new Error(`legacy post wrote an E1 capture record: ${JSON.stringify(captures[0]).slice(0, 200)}`);
}

// Old manifest callbacks are ignored regardless of the retired flag value.
// Drive the real source/package hook with an isolated state home and assert
// no E1 load, state write, output or nonzero exit.
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
const RETIRED_SWITCH_VALUES = [
  { id: 'unset' },
  { id: 'zero', value: '0' },
  { id: 'one', value: '1' },
  { id: 'other', value: 'true' },
];
const ORDINARY_SWITCH_VALUES = RETIRED_SWITCH_VALUES.slice(0, 3);

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

function snapshotSessionTree(root, sessionId) {
  const safeId = String(sessionId || 'default').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  const allFiles = snapshotTree(root);
  return Object.fromEntries(Object.entries(allFiles)
    .filter(([name]) => name.split('/').includes(safeId)));
}

function captureEventRecords(files) {
  return Object.entries(files)
    .filter(([name]) => /(?:^|\/)doc-reconciliation-capture\/\d{8}\.json$/.test(name))
    .map(([, content]) => JSON.parse(content));
}

function driveStatePersistPayload(leg, inputPayload, switchSetting) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-f8-capture-'));
  const stateHome = path.join(temp, 'state-home');
  const wsRoot = path.join(temp, 'workspace');
  fs.mkdirSync(stateHome, { recursive: true });
  fs.mkdirSync(wsRoot, { recursive: true });

  const payload = JSON.parse(JSON.stringify(inputPayload));
  payload.cwd = wsRoot;
  const statePersist = path.join(leg.hooksScripts, 'state-persist.js');
  const sentinel = path.join(temp, 'e1-module-loads.txt');
  const preload = path.join(temp, 'e1-load-sentinel.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const Module = require('module');",
    "const statePersist = path.resolve(process.env.HARNESS_553_STATE_PERSIST);",
    "const sentinel = process.env.HARNESS_553_E1_SENTINEL;",
    "const original = Module._load;",
    "Module._load = function (request, parent, isMain) {",
    "  if (parent?.filename && path.resolve(parent.filename) === statePersist &&",
    "      (request === './lib/doc-reconciliation-pilot' || request === './lib/doc-reconciliation-provider')) {",
    "    fs.appendFileSync(sentinel, 'state-persist.js -> ' + request + '\\n');",
    "  }",
    "  return Reflect.apply(original, this, [request, parent, isMain]);",
    "};",
  ].join('\n') + '\n', 'utf8');

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
  env.HARNESS_553_STATE_PERSIST = statePersist;
  env.HARNESS_553_E1_SENTINEL = sentinel;

  try {
    const result = spawnSync(process.execPath, ['--require', preload, statePersist], {
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
      files: snapshotSessionTree(stateHome, payload.session_id),
      allFiles: snapshotTree(stateHome),
      payload,
      e1Loads: fs.existsSync(sentinel) ? fs.readFileSync(sentinel, 'utf8').trim().split(/\r?\n/) : [],
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function driveCaptureOnlyRoute(leg, route, switchSetting) {
  const payload = {
    hook_event_name: route.event,
    session_id: 'f8-' + route.id,
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
  return driveStatePersistPayload(leg, payload, switchSetting);
}

// locks: historical — the old F8 preload-spy predicate is retired; current
// path checks assert callback side effects and provider non-loading directly.
runner.run('P2B-553-OLD-MANIFEST-CAPTURE-ONLY-QUIET', [], (_mods, leg) => {
  const routeSwitchCases = CAPTURE_ONLY_ROUTES.length * RETIRED_SWITCH_VALUES.length;
  let stateChangeCases = 0;
  let outputCases = 0;
  let captureCases = 0;
  let badExitCases = 0;
  let providerLoadCases = 0;
  for (const route of CAPTURE_ONLY_ROUTES) {
    for (const switchSetting of RETIRED_SWITCH_VALUES) {
      const result = driveCaptureOnlyRoute(leg, route, switchSetting);
      if (result.code !== 0) badExitCases += 1;
      if (result.stdout || result.stderr) outputCases += 1;
      if (Object.keys(result.allFiles).length) stateChangeCases += 1;
      if (captureEventRecords(result.files).length) captureCases += 1;
      if (result.e1Loads.length) providerLoadCases += 1;
    }
  }
  console.log('  SENTINEL ' + path.relative(ROOT, path.join(leg.hooksScripts, 'state-persist.js'))
    + ': E1 provider load in ' + providerLoadCases + '/' + routeSwitchCases + ' callback cases');
  const failures = [];
  if (badExitCases) failures.push('nonzero exit in ' + badExitCases + '/' + routeSwitchCases + ' retired callback cases');
  if (outputCases) failures.push('output emitted in ' + outputCases + '/' + routeSwitchCases + ' retired callback cases');
  if (stateChangeCases) failures.push('state changed in ' + stateChangeCases + '/' + routeSwitchCases + ' retired callback cases');
  if (captureCases) failures.push('capture written in ' + captureCases + '/' + routeSwitchCases + ' retired callback cases');
  if (providerLoadCases) failures.push('E1 provider loaded from state-persist in ' + providerLoadCases + '/' + routeSwitchCases + ' retired callback cases');
  if (failures.length) failures.push(`observed side effects: state=${stateChangeCases}, capture=${captureCases}, output=${outputCases}, nonzero-exit=${badExitCases}`);
  if (failures.length) throw new Error(failures.join('; '));
});

// ---- legacy post retains the handoff golden under retired flag values ----

runner.run('P2B-553-LEGACY-GOLDEN-UNSET', [], (_mods, leg) => {
  legacyGoldenChecks('P2B-553-LEGACY-GOLDEN-UNSET', H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}));
});

runner.run('P2B-553-LEGACY-GOLDEN-ZERO', [], (_mods, leg) => {
  legacyGoldenChecks('P2B-553-LEGACY-GOLDEN-ZERO', H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}, { env: { [PILOT_SWITCH]: '0' } }));
});

runner.run('P2B-553-LEGACY-GOLDEN-OTHER', [], (_mods, leg) => {
  // Unknown legacy flag values are ignored too.
  legacyGoldenChecks('P2B-553-LEGACY-GOLDEN-OTHER', H.driveStatePersist(leg, 'payload-post-tool-use-success.json', {}, { env: { [PILOT_SWITCH]: 'true' } }));
});

// ---- ordinary post outcomes ignore the retired pilot switch -----------

function assertLegacyPost(drive, label, expectedStatus) {
  if (drive.code !== 0) throw new Error(label + ': state-persist exited ' + drive.code);
  if (drive.stdout || drive.stderr) throw new Error(label + ': hook emitted output');
  if (drive.e1Loads.length) throw new Error(label + ': E1 provider loaded: ' + drive.e1Loads.join('; '));
  const names = Object.keys(drive.files);
  if (names.length !== 1 || !names[0].endsWith('/handoff-state.json')) {
    throw new Error(label + ': unexpected state files: ' + JSON.stringify(names));
  }
  if (H.findCaptureRecords(drive.allFiles).length) throw new Error(label + ': E1 capture record was written');
  if (Object.keys(drive.allFiles).some(name => /doc-reconciliation-capture/.test(name))) {
    throw new Error(label + ': E1 journal file was written');
  }
  const state = JSON.parse(drive.files[names[0]]);
  const creditKeys = Object.keys(state).filter(key => /^last(?:Doc|Generic)Verify/.test(key));
  if (creditKeys.length) throw new Error(label + ': E1 verification fields were written: ' + creditKeys.join(','));
  if (state.status !== expectedStatus) throw new Error(label + ': expected status ' + expectedStatus + ', got ' + state.status);
  if (expectedStatus === 'idle' && !Number.isFinite(state.lastVerifyAt)) {
    throw new Error(label + ': successful verification did not update generic lastVerifyAt');
  }
  if (expectedStatus === 'failed' && !String(state.errorSummary || '').includes('r2c1 simulated failure')) {
    throw new Error(label + ': ordinary failure detail was lost: ' + JSON.stringify(state));
  }
  if (expectedStatus === 'failed' && (state.lastVerifyAt !== undefined || state.lastVerifyExitCode !== undefined)) {
    throw new Error(label + ': failed post was recorded as successful verification');
  }
  return state;
}

function normalizeTimeFields(value) {
  if (Array.isArray(value)) return value.map(normalizeTimeFields);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === 'timestamp' || /At$/.test(key) ? '<time>' : normalizeTimeFields(child);
  }
  return out;
}

function legacyPostSignature(drive, state) {
  const files = Object.keys(drive.files).map(name => path.basename(name)).sort();
  return JSON.stringify({ files, state: normalizeTimeFields(state) });
}

runner.run('P2B-553-ORDINARY-POST-FLAG-INDEPENDENCE', [], (_mods, leg) => {
  const cases = [
    { id: 'success', fixture: 'payload-post-tool-use-success.json', status: 'idle' },
    { id: 'failure', fixture: 'payload-post-tool-use-failure.json', status: 'failed' },
  ];
  const failures = [];
  for (const scenario of cases) {
    const signatures = [];
    for (const switchSetting of ORDINARY_SWITCH_VALUES) {
      const label = scenario.id + '/' + switchSetting.id;
      const drive = driveStatePersistPayload(leg, H.payload(scenario.fixture), switchSetting);
      const state = assertLegacyPost(drive, label, scenario.status);
      if (scenario.status === 'idle') legacyGoldenChecks(label, drive);
      signatures.push(legacyPostSignature(drive, state));
    }
    if (signatures.some(signature => signature !== signatures[0])) {
      failures.push(scenario.id + ': ordinary post result changed across unset/0/1');
    }
  }
  console.log('  SENTINEL ' + path.relative(ROOT, path.join(leg.hooksScripts, 'state-persist.js'))
    + ': no E1 provider load across success/failure at unset/0/1');
  if (failures.length) throw new Error(failures.join('; '));
});

function finish(counts) {
  if (counts.FAIL === 0 && counts.INFRA === 0) {
    console.log('state-persist PostToolUse suite: all assertions PASS.');
    process.exit(0);
  }
  console.log(`state-persist PostToolUse suite: FAIL/INFRA present (failed assertions: ${counts.FAIL}, infra faults: ${counts.INFRA}).`);
  process.exit(1);
}

finish(runner.summary());
