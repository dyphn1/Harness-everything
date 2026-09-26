#!/usr/bin/env node
'use strict';
// Assembles a System One holdout (tier or intent stage) from a draft plus human review decisions.
// See docs/system-one-corpus.md and docs/system-one-intent.md. A decision counts only for the exact prompt text it reviewed.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequest } = require('../harness-everything/scripts/system-one/contract');
const { CATALOGS, MULTI, goldLabels, validSecondary } = require('../harness-everything/scripts/system-one/catalogs');
const { validateCorpus } = require('../harness-everything/scripts/system-one/evaluate');

const SOURCES = ['synthetic:authored', 'derived:local-history'];
const LANGUAGES = ['en', 'zh-TW'];
const REVIEWER = 'human:repository-owner';
// Drafts are committed publicly: no email addresses or user home paths.
const PRIVATE = [/[\w.+-]+@[\w-]+\.[\w.-]+/, /[A-Za-z]:\\Users\\/i, /\/home\/[^/\s]+/, /\/Users\/[^/\s]+/];
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const fail = code => { throw new TypeError(code); };
const promptHash = text => createHash('sha256').update(text, 'utf8').digest('hex');

function validateDraft(draft, task = 'tier') {
  const GOLD = goldLabels(task);
  if (!exact(draft, ['schemaVersion', 'cases']) || draft.schemaVersion !== 1 || !Array.isArray(draft.cases) || !draft.cases.length) fail('invalid-draft');
  const ids = new Set(); const prompts = new Set();
  for (const c of draft.cases) {
    if (!exact(c, ['id', 'family', 'language', 'source', 'prompt', 'proposedGold', 'rationale'])
      || ![c.id, c.family, c.prompt, c.rationale].every(nonempty) || !/^[a-z0-9._-]{1,80}$/.test(c.id)
      || !LANGUAGES.includes(c.language) || !SOURCES.includes(c.source) || !GOLD.includes(c.proposedGold)
      || ids.has(c.id) || prompts.has(c.prompt) || PRIVATE.some(re => re.test(c.prompt))) fail('invalid-draft');
    ids.add(c.id); prompts.add(c.prompt);
  }
  return true;
}

function validateReviews(reviews, task = 'tier') {
  const GOLD = goldLabels(task);
  if (!exact(reviews, ['schemaVersion', 'decisions']) || reviews.schemaVersion !== 1 || !Array.isArray(reviews.decisions)) fail('invalid-reviews');
  const ids = new Set();
  for (const d of reviews.decisions) {
    const multi = MULTI.includes(task);
    if (!exact(d, ['id', 'promptHash', 'decision', 'gold', ...(multi ? ['secondary'] : []), 'reviewer']) || !nonempty(d.id) || ids.has(d.id)
      || typeof d.promptHash !== 'string' || !/^[0-9a-f]{64}$/.test(d.promptHash)
      || !['accept', 'relabel', 'reject'].includes(d.decision) || !GOLD.includes(d.gold) || d.reviewer !== REVIEWER
      || !validSecondary(task, d.gold, d.secondary)
      || (d.decision === 'reject' && d.gold !== null)) fail('invalid-reviews');
    ids.add(d.id);
  }
  return true;
}

function build(draft, reviews, task = 'tier') {
  validateDraft(draft, task);
  const byId = new Map();
  if (reviews !== null) {
    validateReviews(reviews, task);
    for (const d of reviews.decisions) {
      const c = draft.cases.find(item => item.id === d.id);
      if (!c) fail('unknown-review-case');
      // Accept keeps the proposed gold; relabel must change it. Checked against the current proposal.
      if ((d.decision === 'accept' && d.gold !== c.proposedGold) || (d.decision === 'relabel' && d.gold === c.proposedGold)) fail('invalid-reviews');
      byId.set(d.id, d);
    }
  }
  const summary = { cases: 0, reviewed: 0, rejected: 0, stale: 0, unreviewed: 0,
    byLanguage: { en: 0, 'zh-TW': 0 }, byGold: Object.fromEntries(CATALOGS[task].map(o => [o.id, 0])),
    ...(MULTI.includes(task) ? { bySecondary: {} } : {}), reviewedHoldoutGate: false };
  const cases = [];
  for (const c of draft.cases) {
    const d = byId.get(c.id);
    const current = d && d.promptHash === promptHash(c.prompt);
    if (d && !current) summary.stale += 1;
    if (current && d.decision === 'reject') { summary.rejected += 1; continue; }
    const reviewed = Boolean(current);
    if (reviewed) summary.reviewed += 1; else if (!d) summary.unreviewed += 1;
    const gold = reviewed ? d.gold : c.proposedGold;
    // Drafts propose only the primary intent; secondary intents come from the reviewer.
    const secondary = MULTI.includes(task) ? { secondary: reviewed ? [...d.secondary] : [] } : {};
    cases.push({ id: c.id, family: c.family, split: 'holdout', language: c.language, source: c.source, reviewed,
      request: createRequest(task, c.prompt, CATALOGS[task]), gold, ...secondary });
    summary.byLanguage[c.language] += 1;
    summary.byGold[gold === null ? 'unclassified' : gold] += 1;
    for (const s of secondary.secondary || []) summary.bySecondary[s] = (summary.bySecondary[s] || 0) + 1;
  }
  summary.cases = cases.length;
  const corpus = { schemaVersion: 1, cases };
  validateCorpus(corpus);
  summary.reviewedHoldoutGate = cases.length >= 200 && cases.every(c => c.reviewed)
    && LANGUAGES.every(lang => summary.byLanguage[lang] >= 50);
  return { corpus, summary };
}

if (require.main === module) {
  try {
    const [op, draftPath, reviewsPath, outPath, task = 'tier', extra] = process.argv.slice(2);
    if (op !== 'build' || !draftPath || !reviewsPath || !outPath || extra) throw new Error('usage');
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const { corpus, summary } = build(read(draftPath), reviewsPath === '-' ? null : read(reviewsPath), task);
    fs.writeFileSync(outPath, `${JSON.stringify(corpus, null, 2)}\n`);
    console.log(JSON.stringify(summary));
  } catch (_) {
    console.error('Usage: system-one-corpus.js build <draft.json> <reviews.json|-> <corpus.json> [tier|intent] (invalid draft, reviews, or path)');
    process.exitCode = 1;
  }
}
module.exports = { validateDraft, validateReviews, build, promptHash, REVIEWER };
