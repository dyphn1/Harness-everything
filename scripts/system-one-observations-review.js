#!/usr/bin/env node
'use strict';
// Build a local, blind review page for System One observations
// (docs/system-one-observations.md#labels-and-how-much-to-trust-them).
// By default it lists missing labels, self-contradictions and router/self
// tier disagreements; --all lists every record with text. The page shows only
// the prompt and the previous message; decisions export as JSON for
// system-one-observations-export.js --owner-review.

const fs = require('fs');
const path = require('path');
const obs = require('../hooks/scripts/lib/observations');

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
}

// Missing labels, self-contradictions, and turns where the router's tier and
// the agent's own tier differ are worth the owner's time.
function disagrees(record) {
  const self = record.selfReport;
  if (!self) return true;
  if (obs.contradictions(self, record.behavior).length) return true;
  return Boolean(record.router && record.router.tier && self.tier && record.router.tier !== self.tier);
}

function page(items) {
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Observation Review</title><style>
:root{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--card:#fff;--bd:#e7e5e4}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--mut:#a8a29e;--card:#292524;--bd:#44403c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"PingFang TC",sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}.box{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px;max-height:40vh;overflow:auto}
.prev{font-size:14px;color:var(--mut)}label{margin-right:16px}select,button{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--fg)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:12px 0}</style></head><body><main>
<p class="prev">Review the prompt with its previous assistant message. Decide validity (would the text alone be enough?) and the tier of the work it asked for.</p>
<div class="row"><span id="pos"></span><button id="prev">&larr;</button><button id="next">&rarr;</button><button id="exp">Export JSON</button><span id="stat" class="prev"></span></div>
<h3>Previous assistant message</h3><div class="box prev" id="previous"></div>
<h3>Prompt</h3><div class="box" id="prompt"></div>
<div class="row"><label>Validity <select id="validity"><option value="">—</option><option>actionable</option><option>invalid</option><option>unsure</option></select></label>
<label>Tier <select id="tier"><option value="">—</option><option>tier1</option><option>tier2</option><option>tier3</option></select></label></div>
</main><script>
const ITEMS=${data};const KEY='harness-observation-review';
let st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){st={}}let i=0;
const $=id=>document.getElementById(id);
function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}}
function render(){if(!ITEMS.length){$('prompt').textContent='Nothing to review.';return}const it=ITEMS[i],d=st[it.id]||{};
$('pos').textContent=(i+1)+' / '+ITEMS.length;$('prompt').textContent=it.prompt;$('previous').textContent=it.previous||'(none)';
$('validity').value=d.validity||'';$('tier').value=d.tier||'';$('stat').textContent='decided '+Object.keys(st).length}
function set(){const it=ITEMS[i];st[it.id]={id:it.id,validity:$('validity').value||null,tier:$('tier').value||null,decidedAt:new Date().toISOString()};save();render()}
$('validity').onchange=set;$('tier').onchange=set;$('prev').onclick=()=>{if(i>0)i--;render()};$('next').onclick=()=>{if(i<ITEMS.length-1)i++;render()};
$('exp').onclick=()=>{const b=new Blob([JSON.stringify({schemaVersion:1,review:KEY,decisions:Object.values(st)},null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='observation-review-decisions.json';a.click()};
render();
</script></body></html>`;
}

function run(args) {
  const store = path.resolve(option(args, '--store', obs.storeRoot()));
  const out = option(args, '--out');
  if (!out) throw new Error('--out is required');
  const all = args.includes('--all');
  const limit = Number(option(args, '--limit', '200'));
  const index = obs.readJson(path.join(store, 'observations-index.json'), null);
  if (!index || !Array.isArray(index.records)) throw new Error(`no observation index in ${store}`);
  const items = [];
  for (const record of index.records) {
    if (record.textDeleted || (!all && !disagrees(record))) continue;
    const text = obs.readJson(path.join(store, 'text', `${record.contentSha256}.json`), null);
    if (!text || !text.prompt) continue;
    items.push({ id: record.id, prompt: text.prompt, previous: text.previous || '' });
    if (items.length >= limit) break;
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, page(items), { mode: 0o600 });
  return { items: items.length, out: path.resolve(out) };
}

if (require.main === module) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)))); } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
module.exports = { run, disagrees };
