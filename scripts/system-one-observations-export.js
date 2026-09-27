#!/usr/bin/env node
'use strict';
// Export System One turn observations to training rows
// (docs/system-one-observations.md#export). Reads the local store; writes
// prompts-observed.jsonl, labels-observed.jsonl and a text-free export report.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const obs = require('../hooks/scripts/lib/observations');

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
}

function family(text) {
  const normalized = String(text || '').toLowerCase().replace(/[\p{P}\p{S}\d]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function validDecision(d) {
  return d && typeof d.id === 'string'
    && [undefined, null, 'actionable', 'invalid', 'unsure'].includes(d.validity)
    && [undefined, null, ...obs.TIERS].includes(d.tier)
    && [undefined, null, true, false].includes(d.contextDependent);
}

function loadReview(file) {
  if (!file) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.review !== 'harness-observation-review' || !Array.isArray(data.decisions)) throw new Error('not a harness-observation-review export');
  const bad = data.decisions.find(d => !validDecision(d));
  if (bad) throw new Error(`invalid owner decision: ${JSON.stringify(bad).slice(0, 200)}`);
  return Object.fromEntries(data.decisions.map(d => [d.id, d]));
}

function derive(record, owner) {
  const self = record.selfReport;
  let validity = self ? self.validity : null;
  let contextDependent = self ? self.contextDependent : null;
  if (owner && owner.validity && owner.validity !== 'unsure') validity = owner.validity;
  if (owner && typeof owner.contextDependent === 'boolean') contextDependent = owner.contextDependent;
  let { tier, source: tierSource } = obs.labelTier(self, owner);
  if (validity === 'invalid' && !(owner && obs.TIERS.includes(owner.tier))) { tier = null; tierSource = tierSource && 'self-report'; }
  const skills = record.behavior && record.behavior.skills && record.behavior.skills.length
    ? record.behavior.skills : (self ? self.skills : []);
  return {
    id: record.id, validity, contextDependent, tier, tierSource,
    intents: self ? self.intents : [], workflow: (self && self.workflow) || (record.router && record.router.strategy) || null,
    skills, contradictions: obs.contradictions(self, record.behavior),
    selfReportReason: record.selfReportReason || null, host: record.host,
  };
}

function rate(pairs) {
  return pairs.length ? pairs.filter(([a, b]) => a === b).length / pairs.length : null;
}

function run(args) {
  const store = path.resolve(option(args, '--store', obs.storeRoot()));
  const out = option(args, '--out');
  if (!out) throw new Error('--out is required');
  const share = Number(option(args, '--validation-share', '0.15'));
  const owner = loadReview(option(args, '--owner-review'));
  obs.sweep(store);
  const index = obs.readJson(path.join(store, 'observations-index.json'), null);
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.records)) throw new Error(`no observation index in ${store}`);
  const rows = [];
  let skippedNoText = 0;
  const now = Date.now();
  for (const record of index.records) {
    // Expiry holds on read too, even if no later turn has swept the store.
    const text = obs.recordText(store, record, now);
    if (!text || !text.prompt) { skippedNoText++; continue; }
    rows.push({ record, text, label: derive(record, owner[record.id]) });
  }
  rows.sort((a, b) => a.record.observedAt.localeCompare(b.record.observedAt));
  const validation = rows.length >= 2 ? Math.max(1, Math.ceil(rows.length * share)) : 0;
  fs.mkdirSync(out, { recursive: true });
  const prompts = rows.map((r, i) => JSON.stringify({ id: r.record.id, family: family(r.text.prompt), source: 'observation',
    split: i >= rows.length - validation ? 'validation' : 'train', text: r.text.prompt, previous: r.text.previous || '' }));
  fs.writeFileSync(path.join(out, 'prompts-observed.jsonl'), prompts.join('\n') + (prompts.length ? '\n' : ''));
  fs.writeFileSync(path.join(out, 'labels-observed.jsonl'), rows.map(r => JSON.stringify(r.label)).join('\n') + (rows.length ? '\n' : ''));
  const withSelf = rows.filter(r => r.record.selfReport);
  // Only turns where the router chose a tier; 'unclassified' is not one.
  const routerSelf = withSelf.filter(r => r.record.router && obs.TIERS.includes(r.record.router.tier)).map(r => [r.record.router.tier, r.record.selfReport.tier]);
  const agreement = { routerVsSelfTier: rate(routerSelf), routerVsSelfPairs: routerSelf.length };
  const contradictions = {};
  for (const r of rows) for (const c of r.label.contradictions) contradictions[c] = (contradictions[c] || 0) + 1;
  const count = key => rows.reduce((acc, r) => { const k = String(key(r)); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const report = {
    schemaVersion: 1, exportedAt: new Date().toISOString(), records: index.records.length, exported: rows.length,
    skippedNoText, validationRows: validation, withSelfReport: withSelf.length,
    selfReportReasons: count(r => r.record.selfReportReason || 'ok'), hosts: count(r => r.record.host),
    validity: count(r => r.label.validity), tiers: count(r => r.label.tier), tierSources: count(r => r.label.tierSource),
    ownerDecisions: Object.keys(owner).length, agreement, contradictions,
  };
  fs.writeFileSync(path.join(out, 'export-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (require.main === module) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)), null, 2)); } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
module.exports = { run, derive, family };
