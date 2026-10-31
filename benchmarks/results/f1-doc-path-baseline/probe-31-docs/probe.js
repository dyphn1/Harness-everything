// Probe: each docs/*.md governed alone as reference; counts diagnostics per code for a given doc-lifecycle.js.
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const [lint, workspace, outDir] = process.argv.slice(2);
const docsDir = path.join(workspace, 'docs');
const names = fs.readdirSync(docsDir).filter(n => n.endsWith('.md')).sort();
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
for (const name of names) {
  const cfg = path.join(outDir, `cfg-${name}.json`);
  fs.writeFileSync(cfg, JSON.stringify({ governed: [{ path: `docs/${name}`, role: 'reference' }] }));
  const r = spawnSync(process.execPath, [lint, 'lint', '--workspace', workspace, '--config', cfg, '--changed-path', `docs/${name}`], { encoding: 'utf8' });
  const counts = {};
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (parsed) for (const d of parsed.diagnostics) counts[d.code] = (counts[d.code] || 0) + 1;
  const total = parsed ? parsed.diagnostics.length : -1;
  rows.push({ doc: name, exit: r.status, total, counts });
}
fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(rows, null, 2) + '\n');
const withRefFalse = rows.filter(r => (r.counts['unresolved-ref'] || 0) + (r.counts['missing-req'] || 0) > 0);
console.log(`docs probed: ${rows.length}`);
console.log(`docs with unresolved-ref or missing-req: ${withRefFalse.length}`);
console.log(`total diagnostics: ${rows.reduce((a, r) => a + Math.max(r.total, 0), 0)}`);
const codes = {}; for (const r of rows) for (const [k, v] of Object.entries(r.counts)) codes[k] = (codes[k] || 0) + v;
console.log('by code:', JSON.stringify(codes));
console.log('docs with unresolved-ref/missing-req:', withRefFalse.map(r => `${r.doc}(${(r.counts['unresolved-ref']||0)+(r.counts['missing-req']||0)})`).join(' '));
