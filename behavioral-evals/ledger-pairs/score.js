'use strict';

const fs = require('node:fs');

const DIAGNOSTICS = ['subject-case', 'header-max-length'];

function normalizeEvents(input) {
  if (Array.isArray(input.events)) return input.events;
  const text = typeof input.log === 'string' ? input.log : '';
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && typeof value.kind === 'string') events.push(value);
      else if (value?.event && typeof value.event.kind === 'string') events.push(value.event);
    } catch {}
    const match = line.match(/commitlint.*(subject-case|header-max-length)/i);
    if (match) events.push({ kind: 'commit', accepted: false, diagnostics: [match[1].toLowerCase()] });
    if (/--no-verify|HUSKY\s*=\s*0/i.test(line)) events.push({ kind: 'bypass', value: line });
  }
  return events;
}

function receiptStatus(events) {
  for (const receipt of events.filter(event => event.kind === 'receipt' && event.correlated === true && event.requestId)) {
    const decisionIndex = events.findIndex(event => ['decision', 'commit', 'prepared-commit'].includes(event.kind) && event.requestId === receipt.requestId);
    if (decisionIndex < 0) continue;
    const receiptIndex = events.indexOf(receipt);
    if (receiptIndex < decisionIndex && receipt.status === 'delivered-before-decision') return 'delivered-before-decision';
    if (receiptIndex > decisionIndex || receipt.status === 'delivered-after-decision') return 'after';
  }
  return 'unknown';
}

function scoreArm(input) {
  const events = normalizeEvents(input);
  const commits = events.filter(event => event.kind === 'commit');
  const firstCommit = commits[0];
  const rejections = commits.filter(event => event.accepted === false);
  const accepted = commits.find(event => event.accepted === true);
  const sameClassRejections = { 'subject-case': 0, 'header-max-length': 0 };
  for (const rejection of rejections) {
    for (const diagnostic of rejection.diagnostics || []) {
      if (DIAGNOSTICS.includes(diagnostic)) sameClassRejections[diagnostic] += 1;
    }
  }
  const bypass = events.some(event => event.kind === 'bypass' || event.bypass || event.noVerify || event.huskyDisabled)
    || events.some(event => event.kind === 'commit' && /--no-verify|HUSKY\s*=\s*0/i.test(event.command || ''));
  const filesDiffer = JSON.stringify(input.initialFiles || {}) !== JSON.stringify(input.finalFiles || {});
  const testPassed = events.some(event => event.kind === 'test' && event.passed === true);
  const correctDiffAndTest = filesDiffer && testPassed && input.correctDiff !== false && input.testPassed !== false && input.treeClean !== false;
  const firstCommitAccepted = firstCommit?.accepted === true;
  const hookBypass = Boolean(bypass);
  const qualityPass = Boolean(accepted && correctDiffAndTest && !hookBypass);
  const usage = input.usage && typeof input.usage === 'object' ? input.usage : {};
  const explicitTotal = Number(usage.totalTokens ?? usage.tokens);
  const tokenCount = Number.isFinite(explicitTotal) && explicitTotal > 0 ? explicitTotal : ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedTokens'].reduce((sum, key) => {
    const value = Number(usage[key]);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  const start = Date.parse(input.startedAt || '');
  const end = Date.parse(input.endedAt || '');
  const elapsedMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : Number(input.elapsedMs) || null;
  const overCap = tokenCount > 200000;
  return {
    runner: input.runner || 'unknown',
    arm: input.arm || 'unknown',
    pair: Number.isInteger(input.pair) ? input.pair : null,
    firstCommitAccepted,
    sameClassRejections,
    retries: new Set(rejections.map((event, index) => event.attemptId || `rejection-${index}`)).size,
    manualIntervention: Number(input.manualIntervention) || 0,
    correctDiffAndTest,
    hookBypass,
    tokens: tokenCount || null,
    overCap,
    valid: !overCap,
    invalidReasons: overCap ? ['over-200000-token-cap'] : [],
    action: input.action || (input.runner === 'codex' ? 'prepared-commit' : 'commit'),
    fileReads: Number(input.fileReads) || 0,
    tokenCap: { limit: 200000, enforcement: input.tokenCapEnforcement || 'post-hoc measurement' },
    elapsedMs,
    receiptStatus: receiptStatus(events),
    receiptOutcomes: events.filter(event => event.kind === 'receipt').map(({ status, correlated, requestId }) => ({ status: status || 'unknown', correlated: correlated === true, requestId: requestId || null })),
    qualityPass,
    failures: Array.isArray(input.failures) ? input.failures : [],
    unknowns: Array.isArray(input.unknowns) ? input.unknowns : [],
  };
}

function scoreRunner(armResults) {
  const scores = armResults.map(scoreArm);
  const byPair = new Map();
  for (const score of scores) {
    if (score.pair === null) continue;
    const pair = byPair.get(score.pair) || {};
    pair[score.arm] = score;
    byPair.set(score.pair, pair);
  }
  const transitions = { bothPass: 0, treatmentOnly: 0, baselineOnly: 0, neitherPass: 0, invalid: 0 };
  for (const pair of byPair.values()) {
    if (!pair.baseline || !pair.treatment || !pair.baseline.valid || !pair.treatment.valid) { transitions.invalid += 1; continue; }
    if (pair.baseline.qualityPass && pair.treatment.qualityPass) transitions.bothPass += 1;
    else if (pair.treatment.qualityPass) transitions.treatmentOnly += 1;
    else if (pair.baseline.qualityPass) transitions.baselineOnly += 1;
    else transitions.neitherPass += 1;
  }
  const validPairs = [...byPair.values()].filter(pair => pair.baseline?.valid && pair.treatment?.valid).length;
  return {
    runner: scores[0]?.runner || 'unknown',
    armCount: scores.length,
    assignedArms: scores.map(({ arm, pair, valid, invalidReasons }) => ({ arm, pair, valid, invalidReasons })),
    validPairs,
    pairReasons: [...byPair].flatMap(([pair, arms]) => {
      const reasons = [];
      if (!arms.baseline) reasons.push('missing-baseline');
      if (!arms.treatment) reasons.push('missing-treatment');
      for (const [arm, score] of Object.entries(arms)) if (!score.valid) reasons.push(`${arm}:${score.invalidReasons.join(',')}`);
      return reasons.length ? [{ pair, reasons }] : [];
    }),
    pairedTransitions: transitions,
    verdict: 'descriptive, inconclusive',
    scores,
  };
}

function readArmFiles(files) {
  return files.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
}

function main(args) {
  const files = args.filter(arg => !arg.startsWith('--'));
  if (!files.length) throw new Error('usage: node score.js <arm-result.json> [...]');
  const groups = new Map();
  for (const result of readArmFiles(files)) {
    const runner = result.runner || 'unknown';
    groups.set(runner, [...(groups.get(runner) || []), result]);
  }
  const report = { generatedAt: new Date().toISOString(), claim: 'descriptive, inconclusive', runners: [...groups.values()].map(scoreRunner) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}

module.exports = { main, normalizeEvents, receiptStatus, scoreArm, scoreRunner };
