'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO, readJsonl, writeJsonl, writeJson, runNode, assertPrivateDataDir } = require('./common');
const observations = require('../../hooks/scripts/lib/observations');
const { importStore } = require('../system-one-observations-import-store');

function collect({ dataDir, since, sessionsDir }) {
  const privateDir = assertPrivateDataDir(dataDir);
  if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('collect requires --since YYYY-MM-DD');
  const training = path.join(privateDir, 'training');
  const store = path.join(training, 'observation-store');
  const observed = path.join(training, 'observed');
  const importer = path.join(REPO, 'scripts', 'system-one-observations-import-codex-sessions.js');
  const exporter = path.join(REPO, 'scripts', 'system-one-observations-export.js');
  const importArgs = ['--store', store, '--since', since];
  if (sessionsDir) importArgs.push('--sessions', sessionsDir);
  const importStartedAt = new Date().toISOString();
  let codexStatus = 'ok';
  try { runNode(importer, importArgs); }
  catch { codexStatus = 'error'; }
  const live = importStore({ sourceRoot: observations.storeRoot(), store, since });
  const importReportFile = path.join(observed, 'import-report.json');
  writeJson(importReportFile, {
    schemaVersion: 1,
    run: { startedAt: importStartedAt },
    sources: { live: live.source, codex: { status: codexStatus } },
    byHost: live.byHost,
  });
  if (codexStatus !== 'ok' || live.source.status === 'error') {
    throw new Error('observation import incomplete; see import-report.json');
  }
  runNode(exporter, ['--store', store, '--out', observed, '--self-report-only', '--since', since]);

  const promptsFile = path.join(observed, 'prompts-observed.jsonl');
  const labelsFile = path.join(observed, 'labels-observed.jsonl');
  const prompts = readJsonl(promptsFile).map(row => {
    for (const key of ['id', 'family', 'source', 'split', 'text']) {
      if (typeof row?.[key] !== 'string') throw new Error(`collected row is missing ${key}`);
    }
    return { id: row.id, family: row.family, source: row.source, split: row.split, text: row.text };
  });
  const labels = readJsonl(labelsFile).map(row => ({
    id: row.id,
    tier: row.tier ?? null,
    intents: Array.isArray(row.intents) ? row.intents : [],
    host: row.host ?? null,
    behaviorEvidence: row.behaviorEvidence || 'unobserved',
    contradictions: Array.isArray(row.contradictions) ? row.contradictions : [],
  }));
  writeJsonl(promptsFile, prompts);
  writeJsonl(labelsFile, labels);
  const exportReportFile = path.join(observed, 'export-report.json');
  const exported = JSON.parse(fs.readFileSync(exportReportFile, 'utf8'));
  writeJson(exportReportFile, Object.fromEntries(['schemaVersion', 'records', 'exported', 'skippedBeforeSince', 'skippedUnlabeled',
    'skippedNoText', 'validationRows', 'withSelfReport'].filter(key => Object.hasOwn(exported, key)).map(key => [key, exported[key]])));
  for (const dir of [training, path.dirname(store), store, observed]) {
    try { fs.chmodSync(dir, 0o700); } catch { /* Windows does not expose POSIX modes. */ }
  }
  for (const file of [promptsFile, labelsFile, path.join(observed, 'export-report.json'), importReportFile]) {
    try { if (fs.existsSync(file)) fs.chmodSync(file, 0o600); } catch { /* Windows does not expose POSIX modes. */ }
  }
  return { prompts: prompts.length, selfLabels: labels.length, since };
}

module.exports = { collect };
