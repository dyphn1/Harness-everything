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

function loadReview(file) {
  if (!file) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.review !== 'harness-observation-review' || !Array.isArray(data.decisions)) throw new Error('not a harness-observation-review export');
  return Object.fromEntries(data.decisions.map(d => [d.id, d]));
}

function derive(record, owner) {
  const self = record.selfReport;
  const breadth = obs.breadthTier(record.behavior);
  let validity = self ? self.validity : null;
  let contextDependent = self ? self.contextDependent : null;
  let tier;
  let tierSource;
  if (owner && owner.validity && owner.validity !== 'unsure') validity = owner.validity;
  if (validity === 'invalid') {
    tier = null;
    tierSource = owner && owner.validity === 'invalid' ? 'owner' : 'self-report';
  } else {
    ({ tier, source: tierSource } = obs.deriveTier(breadth, self ? self.tier : null));
  }
  if (owner && obs.TIERS.includes(owner.tier)) { tier = owner.tier; tierSource = 'owner'; }
  const skills = record.behavior && record.behavior.skills && record.behavior.skills.length
    ? record.behavior.skills : (self ? self.skills : []);
  return {
    id: record.id, validity, contextDependent, tier, tierSource, breadthTier: breadth,
    intents: self ? self.intents : [], workflow: (self && self.workflow) || (record.router && record.router.strategy) || null,
    skills, selfReportReason: record.selfReportReason || null, host: record.host,
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
  const index = obs.readJson(path.join(store, 'observations-index.json'), null);
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.records)) throw new Error(`no observation index in ${store}`);
  const rows = [];
  let skippedNoText = 0;
  for (const record of index.records) {
    const text = record.textDeleted ? null : obs.readJson(path.join(store, 'text', `${record.contentSha256}.json`), null);
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
  const selfBehavior = withSelf.map(r => [r.record.selfReport.tier, obs.breadthTier(r.record.behavior)]);
  const routerSelf = withSelf.filter(r => r.record.router && r.record.router.tier).map(r => [r.record.router.tier, r.record.selfReport.tier]);
  const routerBehavior = rows.filter(r => r.record.router && r.record.router.tier).map(r => [r.record.router.tier, obs.breadthTier(r.record.behavior)]);
  const agreement = { selfVsBehaviorTier: rate(selfBehavior), routerVsSelfTier: rate(routerSelf), routerVsBehaviorTier: rate(routerBehavior) };
  agreement.copyingFlag = agreement.routerVsSelfTier !== null && agreement.routerVsBehaviorTier !== null
    && agreement.routerVsSelfTier - agreement.routerVsBehaviorTier > 0.25;
  const count = key => rows.reduce((acc, r) => { const k = String(key(r)); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const report = {
    schemaVersion: 1, exportedAt: new Date().toISOString(), records: index.records.length, exported: rows.length,
    skippedNoText, validationRows: validation, withSelfReport: withSelf.length,
    selfReportReasons: count(r => r.record.selfReportReason || 'ok'), hosts: count(r => r.record.host),
    validity: count(r => r.label.validity), tiers: count(r => r.label.tier), tierSources: count(r => r.label.tierSource),
    ownerDecisions: Object.keys(owner).length, agreement,
  };
  fs.writeFileSync(path.join(out, 'export-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (require.main === module) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)), null, 2)); } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
module.exports = { run, derive, family };
