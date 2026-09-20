#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_SOURCE = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const INSTALLED_PLUGIN_NAME = 'harness-enforcement.js';
const PRE_REFLECTION_MARKER = 'PRE_REFLECTION_OK';
const FIRST_CYCLE_MARKERS = ['CYCLE1_ATTEMPT_2', 'CYCLE1_ATTEMPT_3'];
const BLOCKED_MARKER = 'BLOCKED_WHILE_REFLECTION_PENDING';
const RETRIP_MARKERS = ['RETRIP_1', 'RETRIP_2', 'RETRIP_3'];
const REFLECTION_REQUIRED_MESSAGE = 'Harness reflection is required before another code edit.';
const PROBE_CONTRACT = 'rule-of-3-reflection-retrip-v2';

const PROMPT = [
  'You are running a live Harness Rule-of-3 reflection-gate integration probe. Follow this sequence exactly.',
  '',
  'Mutable targets are limited to probe.txt and the exact Harness reflection artifact path that the plugin gives you.',
  'Do not modify package.json, opencode.json, .opencode/plugins, or any test command. The npm test failure is intentional and must remain unchanged.',
  '',
  `1. First edit probe.txt and append the exact marker ${PRE_REFLECTION_MARKER}, then end the turn.`,
  `2. After the first verification-failure follow-up, append ${FIRST_CYCLE_MARKERS[0]} and end the turn. After the second, append ${FIRST_CYCLE_MARKERS[1]} and end the turn. The third matching failure should request reflection.`,
  `3. When reflection is first required, BEFORE writing the report, attempt one edit to probe.txt appending ${BLOCKED_MARKER}. Do not work around the rejection. Then write the required report to the exact path with sections ## Goal, ## Failed Attempts, ## Verified Facts, ## Diagnosis, and ## Decision. The first non-empty Decision line must begin with RESUME:, and include the exact reflection token.`,
  `4. After that reflection is accepted, make three successive edits to probe.txt, one per verification cycle, appending ${RETRIP_MARKERS[0]}, then ${RETRIP_MARKERS[1]}, then ${RETRIP_MARKERS[2]}. End the turn after each edit so the intentional verification failure is observed each time.`,
  '5. When Harness requests reflection for the second three-failure cycle, stop. Do not write a second reflection report, reset Harness state, or start a different session.',
].join('\n');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
  } catch (error) {
    return null;
  }
}

function recursiveFind(root, basename) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...recursiveFind(file, basename));
    else if (entry.isFile() && entry.name === basename) out.push(file);
  }
  return out;
}

function parseToolInputs(transcriptFile) {
  if (!fs.existsSync(transcriptFile)) return [];
  const events = [];
  for (const line of fs.readFileSync(transcriptFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const part = event && event.part;
    if (!part || !String(event.type || '').includes('tool')) continue;
    const input = part.state && part.state.input !== undefined ? part.state.input : part.input;
    events.push({ tool: part.tool || 'tool', input: input ?? {} });
  }
  return events;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function verifyReflection(file) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const sections = ['## Goal', '## Failed Attempts', '## Verified Facts', '## Diagnosis', '## Decision'];
  if (!sections.every((section) => text.includes(section))) return false;
  const decision = text.split('## Decision')[1] || '';
  const first = decision.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return Boolean(first && /^RESUME\s*:/i.test(first) && /Reflection token:\s*[A-Za-z0-9_-]+/i.test(text));
}

function verifyEvidence(evidenceDir) {
  const transcriptFile = path.join(evidenceDir, 'transcript.jsonl');
  const stderrFile = path.join(evidenceDir, 'stderr.txt');
  const probeFile = path.join(evidenceDir, 'workspace', 'probe.txt');
  const breakerFile = path.join(evidenceDir, 'state', 'circuit-breaker.json');
  const complianceFile = path.join(evidenceDir, 'state', 'compliance.json');
  const reflectionFile = path.join(evidenceDir, 'state', 'zoom-out-report.md');
  const metadataFile = path.join(evidenceDir, 'metadata.json');

  const checks = [];
  const check = (name, pass, detail = null) => checks.push({ name, pass: Boolean(pass), detail });

  let metadata = {};
  try { metadata = readJson(metadataFile); } catch { /* reported below */ }
  check('metadata records current reflection-gate probe contract', metadata.probeContract === PROBE_CONTRACT, metadata.probeContract || null);
  check('metadata records isolated Harness state', metadata.stateIsolated === true, metadata.stateIsolation || null);
  check('metadata records .js auto-discovery destination', metadata.installedPluginName === INSTALLED_PLUGIN_NAME, metadata.installedPluginName || null);
  check('installed plugin is byte-identical to the recorded canonical source',
    typeof metadata.pluginSha256 === 'string' && metadata.pluginSha256.length === 64 && metadata.installedPluginSha256 === metadata.pluginSha256,
    { source: metadata.pluginSha256 || null, installed: metadata.installedPluginSha256 || null });

  const combined = [transcriptFile, stderrFile]
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  check('live host surfaced the Harness reflection gate error', combined.includes(REFLECTION_REQUIRED_MESSAGE));

  const toolInputs = parseToolInputs(transcriptFile);
  const toolText = toolInputs.map((entry) => JSON.stringify(entry.input)).join('\n');
  check('structured tool trace contains the pre-reflection edit attempt', toolText.includes(PRE_REFLECTION_MARKER));
  check('structured tool trace contains both first-cycle retry edits', FIRST_CYCLE_MARKERS.every((marker) => toolText.includes(marker)));
  check('structured tool trace contains the edit attempt blocked by reflectionPending', toolText.includes(BLOCKED_MARKER));
  check('structured tool trace contains all three post-reflection re-trip edits', RETRIP_MARKERS.every((marker) => toolText.includes(marker)));

  let probe = '';
  try { probe = fs.readFileSync(probeFile, 'utf8'); } catch { /* reported below */ }
  check('pre-reflection edit reached the filesystem', probe.includes(PRE_REFLECTION_MARKER), probe || null);
  check('first-cycle retry edits reached the filesystem', FIRST_CYCLE_MARKERS.every((marker) => probe.includes(marker)), probe || null);
  check('reflection-pending blocked marker did not reach the filesystem', probe.length > 0 && !probe.includes(BLOCKED_MARKER), probe || null);
  check('all post-reflection re-trip edits reached the filesystem before the second reflection', RETRIP_MARKERS.every((marker) => probe.includes(marker)), probe || null);

  let breaker = null;
  try { breaker = readJson(breakerFile); } catch { /* reported below */ }
  const activeSignature = breaker && breaker.reflectionSignature;
  const activeEntry = activeSignature && breaker.failures && breaker.failures[activeSignature];
  check('snapshot has no retired hardLock field',
    breaker && !Object.prototype.hasOwnProperty.call(breaker, 'hardLock'),
    breaker);
  check('snapshot proves one completed reflection',
    breaker && Number.isFinite(breaker.lastReflection) &&
      typeof breaker.lastReflectionSignature === 'string' && breaker.lastReflectionSignature.length > 0,
    breaker);
  check('three more matching failures request a second reflection instead of a permanent lock',
    breaker && breaker.reflectionPending === true &&
      typeof breaker.reflectionToken === 'string' && breaker.reflectionToken.length > 0 &&
      typeof activeSignature === 'string' && activeSignature.length > 0,
    breaker);
  check('the re-trip is for the same verification signature that was previously reflected',
    breaker && activeSignature === breaker.lastReflectionSignature,
    breaker);
  check('post-reflection signature count restarted and reached the next Rule-of-3 boundary',
    activeEntry && Number.isInteger(activeEntry.count) && activeEntry.count >= 3,
    activeEntry || null);
  check('first reflection artifact is valid and preserved', verifyReflection(reflectionFile));

  let compliance = null;
  try { compliance = readJson(complianceFile); } catch { /* reported below */ }
  check('compliance records at least two forced reflections',
    compliance && Number.isInteger(compliance.reflectionsForced) && compliance.reflectionsForced >= 2,
    compliance);

  return {
    schemaVersion: 2,
    verifiedAt: new Date().toISOString(),
    passed: checks.every((entry) => entry.pass),
    checks,
  };
}

function archiveSelectedState(stateHome, evidenceDir) {
  const candidates = [];
  for (const file of recursiveFind(stateHome, 'circuit-breaker.json')) {
    try {
      const state = readJson(file);
      candidates.push({ file, state });
    } catch {
      candidates.push({ file, state: null });
    }
  }
  const selected = candidates.find((candidate) => {
    const state = candidate.state;
    const signature = state && state.reflectionSignature;
    const entry = signature && state.failures && state.failures[signature];
    return Boolean(
      state &&
      state.reflectionPending === true &&
      Number.isFinite(state.lastReflection) &&
      signature &&
      state.lastReflectionSignature === signature &&
      entry &&
      Number.isInteger(entry.count) &&
      entry.count >= 3 &&
      !Object.prototype.hasOwnProperty.call(state, 'hardLock')
    );
  }) || null;
  const rawStateDir = path.join(evidenceDir, 'raw-state');
  if (fs.existsSync(stateHome)) fs.cpSync(stateHome, rawStateDir, { recursive: true });
  if (!selected) return { selected: null, candidates: candidates.map(({ file, state }) => ({ file, state })) };

  const sourceDir = path.dirname(selected.file);
  const targetDir = path.join(evidenceDir, 'state');
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of ['circuit-breaker.json', 'edit-state.json', 'compliance.json', 'zoom-out-report.md']) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, name));
  }
  return {
    selected: path.relative(stateHome, sourceDir).split(path.sep).join('/'),
    candidates: candidates.map(({ file, state }) => ({ file: path.relative(stateHome, file).split(path.sep).join('/'), state })),
  };
}

function defaultEvidenceDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(ROOT, 'benchmarks', 'results', 'live-host', `opencode-reflection-gate-${stamp}`);
}

function runLive(options = {}) {
  const evidenceDir = path.resolve(options.out || defaultEvidenceDir());
  if (fs.existsSync(evidenceDir) && fs.readdirSync(evidenceDir).length > 0) {
    throw new Error(`evidence output directory must be empty or absent: ${evidenceDir}`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-opencode-reflection-gate-'));
  const workspace = path.join(tempRoot, 'workspace');
  const stateHome = path.join(tempRoot, 'state-home');
  const transcriptFile = path.join(evidenceDir, 'transcript.jsonl');
  const stderrFile = path.join(evidenceDir, 'stderr.txt');
  const workspaceEvidenceDir = path.join(evidenceDir, 'workspace');
  const model = options.model || process.env.BEHAVIORAL_MODEL || null;
  const opencode = options.opencode || 'opencode';

  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, '.opencode', 'plugins'), { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'probe.txt'), 'baseline\n', 'utf8');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'harness-opencode-reflection-gate-live-probe',
    private: true,
    version: '0.0.0',
    scripts: { test: "node -e \"console.log('HARNESS_LIVE_PROBE_RED'); process.exit(1)\"" },
  }, null, 2));
  fs.writeFileSync(path.join(workspace, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2));
  const installedPluginFile = path.join(workspace, '.opencode', 'plugins', INSTALLED_PLUGIN_NAME);
  fs.copyFileSync(PLUGIN_SOURCE, installedPluginFile);
  fs.writeFileSync(path.join(evidenceDir, 'prompt.txt'), PROMPT + '\n', 'utf8');

  const args = ['run', '--format', 'json', '--auto', '--dir', workspace];
  if (model) args.push('-m', model);
  args.push(PROMPT);
  const startedAt = new Date().toISOString();
  const result = spawnSync(opencode, args, {
    cwd: workspace,
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  fs.writeFileSync(transcriptFile, result.stdout || '', 'utf8');
  fs.writeFileSync(stderrFile, result.stderr || '', 'utf8');
  fs.mkdirSync(workspaceEvidenceDir, { recursive: true });
  for (const name of ['probe.txt', 'package.json', 'opencode.json']) {
    const source = path.join(workspace, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(workspaceEvidenceDir, name));
  }

  const stateArchive = archiveSelectedState(stateHome, evidenceDir);
  const metadata = {
    schemaVersion: 2,
    probeContract: PROBE_CONTRACT,
    startedAt,
    completedAt: new Date().toISOString(),
    opencodeVersion: safeCommand(opencode, ['--version']),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    repoCommit: safeCommand('git', ['rev-parse', 'HEAD'], { cwd: ROOT }),
    model,
    installedPluginName: INSTALLED_PLUGIN_NAME,
    pluginSource: 'opencode-plugin/index.mjs',
    pluginSha256: sha256File(PLUGIN_SOURCE),
    installedPluginSha256: sha256File(installedPluginFile),
    stateIsolated: true,
    stateIsolation: { env: 'HARNESS_STATE_HOME', location: 'temporary' },
    opencodeExitStatus: result.status,
    opencodeSignal: result.signal || null,
    spawnError: result.error ? String(result.error.message || result.error) : null,
    selectedState: stateArchive.selected,
    stateCandidates: stateArchive.candidates,
  };
  fs.writeFileSync(path.join(evidenceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  const verification = verifyEvidence(evidenceDir);
  fs.writeFileSync(path.join(evidenceDir, 'verification.json'), JSON.stringify(verification, null, 2));
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`${verification.passed ? 'PASS' : 'FAIL'}: ${evidenceDir}`);
  for (const item of verification.checks) {
    console.log(`  ${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass || item.detail == null ? '' : ` — ${typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail)}`}`);
  }
  return verification.passed ? 0 : 1;
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'run') {
    return runLive({ out: flag(argv, '--out'), model: flag(argv, '--model'), opencode: flag(argv, '--opencode') });
  }
  if (command === 'verify') {
    const evidenceDir = argv[1];
    if (!evidenceDir) throw new Error('verify requires an evidence directory');
    const verification = verifyEvidence(path.resolve(evidenceDir));
    fs.writeFileSync(path.join(path.resolve(evidenceDir), 'verification.json'), JSON.stringify(verification, null, 2));
    console.log(`${verification.passed ? 'PASS' : 'FAIL'}: ${path.resolve(evidenceDir)}`);
    for (const item of verification.checks) console.log(`  ${item.pass ? 'PASS' : 'FAIL'} ${item.name}`);
    return verification.passed ? 0 : 1;
  }
  console.log('Usage:\n  node behavioral-evals/opencode-reflection-gate-live.js run [--out <dir>] [--model <model>] [--opencode <path>]\n  node behavioral-evals/opencode-reflection-gate-live.js verify <evidence-dir>');
  return command ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  BLOCKED_MARKER,
  FIRST_CYCLE_MARKERS,
  INSTALLED_PLUGIN_NAME,
  PRE_REFLECTION_MARKER,
  PROBE_CONTRACT,
  PROMPT,
  REFLECTION_REQUIRED_MESSAGE,
  RETRIP_MARKERS,
  main,
  parseToolInputs,
  verifyEvidence,
  verifyReflection,
};
