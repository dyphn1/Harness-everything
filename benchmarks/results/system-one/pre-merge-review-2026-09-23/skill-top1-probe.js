'use strict';
// Diagnostic: does the System One scorer's top-1 point at the right skill for historical routing inputs?
// Usage: node skill-probe.js <repoRoot> <absolute manifest> <out.json>
const fs = require('node:fs');
const path = require('node:path');
const [root, manifestPath, outPath] = process.argv.slice(2);
const S1 = path.join(root, 'harness-everything/scripts/system-one');
const { createRequest, decide } = require(path.join(S1, 'contract'));
const provider = require(path.join(S1, 'provider'));
const resident = require(path.join(S1, 'resident'));
const { run: route } = require(path.join(root, 'harness-everything/scripts/tier-router'));

const OPTION_BYTES = 96;
const CONTEXT_BYTES = 224;
const bytes = s => Buffer.byteLength(s, 'utf8');
function fit(text, max) { // explicit catalog construction: cut at a word boundary, never mid-character
  if (bytes(text) <= max) return text;
  const words = text.split(/\s+/); let out = '';
  for (const w of words) { const next = out ? `${out} ${w}` : w; if (bytes(next) > max) break; out = next; }
  return out;
}
const skills = fs.readdirSync(path.join(root, 'evals')).filter(d => fs.existsSync(path.join(root, d, 'SKILL.md'))).sort();
const options = skills.map(id => {
  const md = fs.readFileSync(path.join(root, id, 'SKILL.md'), 'utf8');
  const desc = (md.match(/^description:\s*"?(.*?)"?\s*$/m) || [])[1] || id;
  return { id, text: fit(`${id}: ${desc.replace(/\\"/g, '"')}`, OPTION_BYTES) };
});

const cfg = require(path.join(root, 'harness-everything/scripts/routing-keywords.json'));
const keywordGold = new Map();
for (const g of cfg.guideGroups) {
  const gs = [...new Set((g.guides || []).map(s => (s.match(/^- ([^/\s]+)\//) || [])[1]).filter(id => skills.includes(id)))];
  for (const kw of g.keywords || []) {
    const set = keywordGold.get(kw) || new Set(); gs.forEach(s => set.add(s)); keywordGold.set(kw, set);
  }
}
const setA = [...keywordGold].map(([kw, gold]) => ({ set: 'A-keyword', context: kw, gold: [...gold] }));
const setB = [];
for (const id of skills) {
  const dir = path.join(root, 'evals', id, 'tasks');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.yaml'))) {
    const y = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/should_trigger:\s*true/.test(y)) continue;
    const m = y.match(/^\s*prompt:\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.+))\s*$/m);
    if (m) setB.push({ set: 'B-eval-prompt', context: JSON.parse(`"${(m[1] ?? m[2] ?? m[3]).replace(/\n/g, ' ')}"`.replace(/^""$/, '""')), gold: [id], task: f });
  }
}

const manifest = provider.readManifest(manifestPath);
if (manifest.transport === 'resident' && !resident.ensureReady(manifest, manifestPath, 60000)) throw new Error('resident not ready');
const originalLog = console.log;
const rows = [];
for (const item of [...setA, ...setB]) {
  const row = { ...item, bytes: bytes(item.context) };
  if (row.bytes > CONTEXT_BYTES) { rows.push({ ...row, status: 'context-over-limit' }); continue; }
  const request = createRequest('skill', item.context, options);
  const result = provider.score(request, manifestPath);
  if (result.status !== 'scored') { rows.push({ ...row, status: result.reason }); continue; }
  const d = decide(request, result.response);
  const ranked = [...result.response.scores].sort((a, b) => b.probability - a.probability);
  let lexical = null;
  if (item.set === 'B-eval-prompt') { // lexical baseline: does the keyword router recommend the gold skill at all?
    console.log = () => {};
    try { const out = []; console.log = (...a) => out.push(a.join(' ')); route(item.context); lexical = out.join('\n').includes(`- ${item.gold[0]}/`); }
    finally { console.log = originalLog; }
  }
  rows.push({ ...row, status: 'scored', decision: d.reason, top1: ranked[0].id, top1p: ranked[0].probability,
    top3: ranked.slice(0, 3).map(r => r.id), correctTop1: item.gold.includes(ranked[0].id),
    correctTop3: ranked.slice(0, 3).some(r => item.gold.includes(r.id)), lexicalRecommendsGold: lexical });
}
const summarize = set => {
  const r = rows.filter(x => x.set === set); const s = r.filter(x => x.status === 'scored');
  const dist = {}; s.forEach(x => { dist[x.top1] = (dist[x.top1] || 0) + 1; });
  return { total: r.length, scored: s.length, rejected: r.length - s.length,
    top1Correct: s.filter(x => x.correctTop1).length, top3Correct: s.filter(x => x.correctTop3).length,
    highConfidenceWrong: s.filter(x => !x.correctTop1 && x.top1p >= 0.9).length,
    decisions: [...new Set(s.map(x => x.decision))], top1Distribution: Object.entries(dist).sort((a, b) => b[1] - a[1]),
    lexicalRecommendsGold: set === 'B-eval-prompt' ? s.filter(x => x.lexicalRecommendsGold).length : undefined };
};
const report = { options, summary: { A: summarize('A-keyword'), B: summarize('B-eval-prompt') }, rows };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 1));
