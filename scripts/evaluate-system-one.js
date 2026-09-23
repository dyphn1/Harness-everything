#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { validateCorpus, evaluate } = require('../harness-everything/scripts/system-one/evaluate');
const { score, provenance } = require('../harness-everything/scripts/system-one/provider');
const { decide } = require('../harness-everything/scripts/system-one/contract');
const { run: route } = require('../harness-everything/scripts/tier-router');

function run(corpus, manifest) {
  validateCorpus(corpus);
  const records = [];
  const originalMode = process.env.HARNESS_SYSTEM_ONE_MODE;
  const originalLog = console.log;
  try {
    process.env.HARNESS_SYSTEM_ONE_MODE = 'off';
    console.log = () => {};
    for (const c of corpus.cases.filter(item => item.split === 'holdout')) {
      const tier = route(c.request.context).workflowPlan.tier;
      const runs = [];
      for (let i = 0; i < 2; i++) {
        const start = performance.now();
        const result = score(c.request, manifest);
        const decision = result.status === 'scored' ? decide(c.request, result.response) : result;
        if (decision.selectedId === 'unclassified') Object.assign(decision, { status: 'abstain', reason: 'unclassified', selectedId: null });
        const scores = ['accepted', 'abstain'].includes(decision.status) ? result.response.scores.map(s => s.probability) : null;
        runs.push({ decision, scores, latencyMs: performance.now() - start, coldStart: true });
      }
      records.push({ id: c.id, baseline: tier === 'unclassified' ? null : tier, runs });
    }
  } finally {
    console.log = originalLog;
    if (originalMode === undefined) delete process.env.HARNESS_SYSTEM_ONE_MODE;
    else process.env.HARNESS_SYSTEM_ONE_MODE = originalMode;
  }
  let artifact = null;
  try {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    artifact = { declaredModelId: m.modelId, declaredRevision: m.revision, weightsSha256: m.weightsSha256, configSha256: m.configSha256 };
  } catch (_) { /* Missing provider remains an explicit unavailable measurement. */ }
  const source = provenance(manifest);
  return { ...evaluate(corpus, records, source), evidence: { kind: 'offline-one-shot', artifact, source,
    environment: { cpu: os.cpus()[0]?.model || 'unknown', os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version,
      python: source.status === 'recorded' ? source.provenance.python : null, threads: 1 },
    limitations: ['No independently verified holdout review', 'No warm inference measurement', 'No live-host or policy evidence'] }, records };
}
if (require.main === module) {
  try {
    const [input, manifest, output, extra] = process.argv.slice(2);
    if (!input || !manifest || !output || extra) throw new Error('usage');
    const report = run(JSON.parse(fs.readFileSync(input, 'utf8')), manifest);
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ cases: report.cases, coverage: report.model.coverage, rolloutReady: report.rolloutReady }));
  } catch (_) { console.error('System One evaluation failed: invalid corpus, arguments, or output path.'); process.exitCode = 1; }
}
module.exports = { run };
