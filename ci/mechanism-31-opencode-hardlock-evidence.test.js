const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');
const {
  BLOCKED_MARKER,
  FIRST_CYCLE_MARKERS,
  INSTALLED_PLUGIN_NAME,
  PRE_REFLECTION_MARKER,
  PROBE_CONTRACT,
  REFLECTION_REQUIRED_MESSAGE,
  RETRIP_MARKERS,
  verifyEvidence,
} = require('../behavioral-evals/opencode-reflection-gate-live');

console.log('\n[31] opencode live Rule-of-3 reflection evidence contract...');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function makeEvidence() {
  const dir = helper.tempDir('.mechanism-test-opencode-live-reflection-evidence');
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  const pluginHash = 'a'.repeat(64);
  writeJson(path.join(dir, 'metadata.json'), {
    schemaVersion: 2, probeContract: PROBE_CONTRACT, stateIsolated: true,
    installedPluginName: INSTALLED_PLUGIN_NAME, pluginSha256: pluginHash, installedPluginSha256: pluginHash,
  });
  const toolEvent = (input) => JSON.stringify({ type: 'tool', part: { tool: 'edit', state: { input } } });
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), [
    toolEvent({ filePath: 'probe.txt', text: PRE_REFLECTION_MARKER }),
    ...FIRST_CYCLE_MARKERS.map((marker) => toolEvent({ filePath: 'probe.txt', text: marker })),
    toolEvent({ filePath: 'probe.txt', text: BLOCKED_MARKER }),
    ...RETRIP_MARKERS.map((marker) => toolEvent({ filePath: 'probe.txt', text: marker })),
    JSON.stringify({ type: 'text', part: { text: REFLECTION_REQUIRED_MESSAGE } }), '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'stderr.txt'), '', 'utf8');
  fs.writeFileSync(path.join(dir, 'workspace', 'probe.txt'), ['baseline', PRE_REFLECTION_MARKER, ...FIRST_CYCLE_MARKERS, ...RETRIP_MARKERS, ''].join('\n'), 'utf8');
  const signature = 'npm test: HARNESS_LIVE_PROBE_RED';
  writeJson(path.join(dir, 'state', 'circuit-breaker.json'), {
    failures: { [signature]: { count: 3, firstSeen: 5, lastSeen: 8 } },
    lastReflection: 4, lastReflectionSignature: signature, reflectionPending: true,
    reflectionRequestedAt: 8, reflectionToken: 'second456', reflectionSignature: signature,
  });
  writeJson(path.join(dir, 'state', 'compliance.json'), {
    sessionStart: 1, totalEdits: 6, verifiedEdits: 0, circuitBreakerTrips: 2, reflectionsForced: 2,
  });
  fs.writeFileSync(path.join(dir, 'state', 'zoom-out-report.md'), [
    '## Goal','exercise the Rule-of-3 reflection gate','## Failed Attempts','three controlled failures',
    '## Verified Facts','the verification fixture intentionally stays red','## Diagnosis','this is a live enforcement probe',
    '## Decision','RESUME: reproduce the same three-failure cycle after reflection','Reflection token: first123','',
  ].join('\n'));
  return dir;
}

try {
  const valid=makeEvidence(); let result=verifyEvidence(valid);
  helper.check('31. complete attributed reflection/re-trip evidence passes',result.passed,JSON.stringify(result.checks.filter((entry)=>!entry.pass)));

  const wrongPlugin=makeEvidence(); const mf=path.join(wrongPlugin,'metadata.json'); const md=JSON.parse(fs.readFileSync(mf,'utf8'));
  md.installedPluginSha256='b'.repeat(64); writeJson(mf,md); result=verifyEvidence(wrongPlugin);
  helper.check('31. evidence fails when the installed plugin hash differs from the canonical source hash',!result.passed&&result.checks.some((e)=>e.name==='installed plugin is byte-identical to the recorded canonical source'&&!e.pass),JSON.stringify(result.checks));

  const landed=makeEvidence(); fs.appendFileSync(path.join(landed,'workspace','probe.txt'),`${BLOCKED_MARKER}\n`); result=verifyEvidence(landed);
  helper.check('31. reflection gate fails if the blocked marker reached the filesystem',!result.passed&&result.checks.some((e)=>e.name==='reflection-pending blocked marker did not reach the filesystem'&&!e.pass),JSON.stringify(result.checks));

  const retired=makeEvidence(); const bf=path.join(retired,'state','circuit-breaker.json'); const bs=JSON.parse(fs.readFileSync(bf,'utf8')); bs.hardLock=true; writeJson(bf,bs); result=verifyEvidence(retired);
  helper.check('31. current evidence rejects the retired hardLock field',!result.passed&&result.checks.some((e)=>e.name==='snapshot has no retired hardLock field'&&!e.pass),JSON.stringify(result.checks));

  const noRetrip=makeEvidence(); const rf=path.join(noRetrip,'state','circuit-breaker.json'); const rs=JSON.parse(fs.readFileSync(rf,'utf8')); rs.reflectionPending=false; rs.reflectionToken=null; rs.reflectionSignature=null; writeJson(rf,rs); result=verifyEvidence(noRetrip);
  helper.check('31. evidence fails without a second Rule-of-3 reflection request',!result.passed&&result.checks.some((e)=>e.name==='three more matching failures request a second reflection instead of a permanent lock'&&!e.pass),JSON.stringify(result.checks));

  const noAttempt=makeEvidence(); const tf=path.join(noAttempt,'transcript.jsonl'); fs.writeFileSync(tf,fs.readFileSync(tf,'utf8').split(/\r?\n/).filter((line)=>!line.includes(BLOCKED_MARKER)).join('\n')); result=verifyEvidence(noAttempt);
  helper.check('31. evidence fails when no structured edit was attempted during reflectionPending',!result.passed&&result.checks.some((e)=>e.name==='structured tool trace contains the edit attempt blocked by reflectionPending'&&!e.pass),JSON.stringify(result.checks));

  const noReflection=makeEvidence(); fs.rmSync(path.join(noReflection,'state','zoom-out-report.md')); result=verifyEvidence(noReflection);
  helper.check('31. evidence fails without the preserved first reflection artifact',!result.passed&&result.checks.some((e)=>e.name==='first reflection artifact is valid and preserved'&&!e.pass),JSON.stringify(result.checks));

  helper.finish();
} catch(error) { helper.check('31. OpenCode Rule-of-3 reflection live evidence contract',false,error.stack); helper.finish(); }
