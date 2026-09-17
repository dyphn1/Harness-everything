const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');
const {
  BLOCKED_MARKER,
  HARDLOCK_MESSAGE,
  INSTALLED_PLUGIN_NAME,
  POST_REFLECTION_MARKER,
  PRELOCK_MARKER,
  verifyEvidence,
} = require('../behavioral-evals/opencode-hardlock-live');

console.log('\n[31] opencode live hard-lock evidence contract...');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function makeEvidence() {
  const dir = helper.tempDir('.mechanism-test-opencode-live-evidence');
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  writeJson(path.join(dir, 'metadata.json'), {
    schemaVersion: 1,
    stateIsolated: true,
    installedPluginName: INSTALLED_PLUGIN_NAME,
  });
  const toolEvent = (input) => JSON.stringify({
    type: 'tool',
    part: { tool: 'edit', state: { input } },
  });
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), [
    toolEvent({ filePath: 'probe.txt', text: PRELOCK_MARKER }),
    toolEvent({ filePath: 'probe.txt', text: POST_REFLECTION_MARKER }),
    toolEvent({ filePath: 'probe.txt', text: BLOCKED_MARKER }),
    JSON.stringify({ type: 'text', part: { text: `${HARDLOCK_MESSAGE} after a repeat failure post-reflection.` } }),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'stderr.txt'), '', 'utf8');
  fs.writeFileSync(path.join(dir, 'workspace', 'probe.txt'), `baseline\n${PRELOCK_MARKER}\n${POST_REFLECTION_MARKER}\n`, 'utf8');
  writeJson(path.join(dir, 'state', 'circuit-breaker.json'), {
    failures: {
      'npm test: HARNESS_LIVE_PROBE_RED': { count: 4, firstSeen: 1, lastSeen: 5 },
    },
    hardLock: true,
    lastReflection: 4,
    lastReflectionSignature: 'npm test: HARNESS_LIVE_PROBE_RED',
    reflectionPending: false,
    reflectionRequestedAt: null,
    reflectionToken: null,
    reflectionSignature: null,
  });
  fs.writeFileSync(path.join(dir, 'state', 'zoom-out-report.md'), [
    '## Goal',
    'exercise the breaker',
    '## Failed Attempts',
    'three controlled failures',
    '## Verified Facts',
    'the verification fixture intentionally stays red',
    '## Diagnosis',
    'this is a live enforcement probe',
    '## Decision',
    'RESUME: reproduce the same failure once after reflection',
    'Reflection token: abc123',
    '',
  ].join('\n'));
  return dir;
}

try {
  const valid = makeEvidence();
  let result = verifyEvidence(valid);
  helper.check('31. complete attributed hard-lock evidence passes', result.passed, JSON.stringify(result.checks.filter((entry) => !entry.pass)));

  const landed = makeEvidence();
  fs.appendFileSync(path.join(landed, 'workspace', 'probe.txt'), `${BLOCKED_MARKER}\n`);
  result = verifyEvidence(landed);
  helper.check(
    '31. negative control fails if the blocked marker reached the filesystem',
    !result.passed && result.checks.some((entry) => entry.name === 'blocked marker did not reach the filesystem' && !entry.pass),
    JSON.stringify(result.checks),
  );

  const unlocked = makeEvidence();
  const breakerFile = path.join(unlocked, 'state', 'circuit-breaker.json');
  const breaker = JSON.parse(fs.readFileSync(breakerFile, 'utf8'));
  breaker.hardLock = false;
  writeJson(breakerFile, breaker);
  result = verifyEvidence(unlocked);
  helper.check(
    '31. evidence fails without a pre-reset hard-lock snapshot',
    !result.passed && result.checks.some((entry) => entry.name === 'pre-reset breaker snapshot is hard-locked' && !entry.pass),
    JSON.stringify(result.checks),
  );

  const noAttempt = makeEvidence();
  const transcript = fs.readFileSync(path.join(noAttempt, 'transcript.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.includes(BLOCKED_MARKER))
    .join('\n');
  fs.writeFileSync(path.join(noAttempt, 'transcript.jsonl'), transcript);
  result = verifyEvidence(noAttempt);
  helper.check(
    '31. evidence fails when the final blocked edit was never observed as a structured tool attempt',
    !result.passed && result.checks.some((entry) => entry.name === 'structured tool trace contains the final blocked edit attempt' && !entry.pass),
    JSON.stringify(result.checks),
  );

  const noReflection = makeEvidence();
  fs.rmSync(path.join(noReflection, 'state', 'zoom-out-report.md'));
  result = verifyEvidence(noReflection);
  helper.check(
    '31. evidence fails without the preserved reflection artifact',
    !result.passed && result.checks.some((entry) => entry.name === 'reflection artifact is valid and preserved' && !entry.pass),
    JSON.stringify(result.checks),
  );

  helper.finish();
} catch (error) {
  helper.check('31. OpenCode hard-lock live evidence contract', false, error.stack);
  helper.finish();
}
