#!/usr/bin/env node
/**
 * Harness Consistency Check
 * Validates that the docs surface, skill catalog, and distribution manifests
 * tell the same story. A stale manifest or a dead README link is a router
 * that lies — this script keeps them honest.
 *
 * Checks:
 *  1. Every skill dir's SKILL.md frontmatter name matches its directory.
 *  2. Every SKILL.md has a description and both trigger sections.
 *  3. .claude-plugin/plugin.json + marketplace.json list exactly the on-disk skills.
 *  4. Version strings agree across package.json / plugin.json / marketplace.json.
 *  5. Every skill has a routing eval (evals/<skill>/eval.yaml).
 *  6. Local links in README.md and docs markdown files resolve to real files.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`✅ ${name}`);
  } else {
    console.error(`❌ ${name}`);
    if (detail) console.error(`   ${detail}`);
    failures++;
  }
}

// --- Collect skills from disk -------------------------------------------
const SKIP_DIRS = new Set([
  '.git', '.github', '.claude-plugin', 'bin', 'docs', 'evals',
  'behavioral-evals', 'benchmarks', 'hooks', 'node_modules', 'references', 'scripts'
]);
function discoverSkills() {
  const skills = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const skillMd = path.join(ROOT, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const raw = fs.readFileSync(skillMd, 'utf8');
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch ? fmMatch[1] : '';
    const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
    const desc = (fm.match(/^description:\s*(.+)$/m) || [])[1];
    skills.push({
      dir: entry.name,
      name: name ? name.trim().replace(/["']/g, '') : null,
      description: desc ? desc.trim() : null,
      body: raw,
      path: skillMd,
    });
  }
  return skills.sort((a, b) => a.dir.localeCompare(b.dir));
}
const skills = discoverSkills();
check(`Found ${skills.length} skills on disk`, skills.length >= 20, `Got ${skills.length}`);

// --- 1+2. Frontmatter & trigger sections --------------------------------
for (const s of skills) {
  check(
    `${s.dir}: frontmatter name matches directory`,
    s.name === s.dir,
    `frontmatter "${s.name}" != dir "${s.dir}"`
  );
  check(
    `${s.dir}: has description in frontmatter`,
    !!s.description && s.description.length > 10,
    s.description ? 'description too short' : 'missing description'
  );
  check(`${s.dir}: has "## USE FOR:" section`, /^## USE FOR:/m.test(s.body), 'missing section');
  check(
    `${s.dir}: has "## DO NOT USE FOR:" section`,
    /^## DO NOT USE FOR:/m.test(s.body),
    'missing section'
  );
}

// --- 3+4. Distribution manifests -----------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pluginJsonPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
const marketplaceJsonPath = path.join(ROOT, '.claude-plugin', 'marketplace.json');
check('.claude-plugin/plugin.json exists', fs.existsSync(pluginJsonPath));
check('.claude-plugin/marketplace.json exists', fs.existsSync(marketplaceJsonPath));

if (fs.existsSync(pluginJsonPath)) {
  const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  const listed = new Set((plugin.skills || []).map((p) => p.replace(/^\.\//, '').replace(/\/$/, '')));
  const onDisk = new Set(skills.map((s) => s.dir));
  const missing = [...onDisk].filter((d) => !listed.has(d));
  const extra = [...listed].filter((d) => !onDisk.has(d));
  check(
    'plugin.json lists every on-disk skill',
    missing.length === 0,
    `missing: ${missing.join(', ')}`
  );
  check(
    'plugin.json lists no phantom skills',
    extra.length === 0,
    `extra: ${extra.join(', ')}`
  );
  check('plugin.json hooks file exists', !plugin.hooks || fs.existsSync(path.join(ROOT, plugin.hooks)), plugin.hooks);
  for (const rel of plugin.skills || []) {
    const p = path.join(ROOT, rel);
    check(`plugin.json skill path resolves: ${rel}`, fs.existsSync(path.join(p, 'SKILL.md')));
  }
  check(
    'version agrees: package.json vs plugin.json',
    pkg.version === plugin.version,
    `"${pkg.version}" vs "${plugin.version}"`
  );
  if (fs.existsSync(marketplaceJsonPath)) {
    const market = JSON.parse(fs.readFileSync(marketplaceJsonPath, 'utf8'));
    const entry = (market.plugins || []).find((p) => p.name === plugin.name);
    check('marketplace.json references this plugin', !!entry);
    if (entry && entry.version) {
      check(
        'version agrees: package.json vs marketplace.json',
        pkg.version === entry.version,
        `"${pkg.version}" vs "${entry.version}"`
      );
    }
  }
}

// --- 5. Routing eval coverage --------------------------------------------
const evalsDir = path.join(ROOT, 'evals');
for (const s of skills) {
  check(
    `${s.dir}: has routing eval (evals/${s.dir}/eval.yaml)`,
    fs.existsSync(path.join(evalsDir, s.dir, 'eval.yaml')),
    'no trigger/routing eval for this skill'
  );
}

// --- 5b. Skill version ceiling --------------------------------------------
// Skill frontmatter versions move in lockstep with releases; no skill may
// exceed the package version's numeric base (prerelease suffixes ignored).
function verBase(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}
function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
const pkgBase = verBase(pkg.version);
check(
  `package.json version parses (${pkg.version})`,
  !!pkgBase
);
for (const s of skills) {
  const raw = fs.readFileSync(s.path, 'utf8');
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const vRaw = ((fm.match(/^  version:\s*(.+)$/m) || [])[1] || '').trim();
  const v = verBase(vRaw);
  check(
    `${s.dir}: skill version ${vRaw || '(missing)'} <= package base ${pkgBase ? pkgBase.join('.') : '?'}`,
    !!v && !!pkgBase && cmpVer(v, pkgBase) <= 0,
    v ? 'skill version exceeds package version' : 'missing or unparseable metadata.version'
  );
}

// --- 5c. Nested sub-skill versions -----------------------------------------
// Sub-skills nested inside a parent skill dir (<skill>/<sub>/SKILL.md) are
// invoked by the parent, not routed independently; they inherit the parent
// skill's version so the lockstep policy stays enforceable.
const nestedSubSkills = [];
for (const s of skills) {
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, 'SKILL.md'))) nestedSubSkills.push(sub);
      else walk(sub);
    }
  })(path.join(ROOT, s.dir));
}
for (const sub of nestedSubSkills) {
  const rel = path.relative(ROOT, path.join(sub, 'SKILL.md'));
  const parentDir = path.dirname(sub);
  const parentRaw = fs.readFileSync(path.join(parentDir, 'SKILL.md'), 'utf8');
  const parentFm = (parentRaw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const parentV = ((parentFm.match(/^  version:\s*(.+)$/m) || [])[1] || '').trim();
  const raw = fs.readFileSync(path.join(sub, 'SKILL.md'), 'utf8');
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const v = ((fm.match(/^  version:\s*(.+)$/m) || [])[1] || '').trim();
  check(
    `${rel}: nested sub-skill inherits parent version (${parentV})`,
    !!v && v === parentV,
    `"${v}" != parent "${parentV}"`
  );
}

// --- 5d. Word-count budget (token proxy) ------------------------------------
// Skill frontmatter descriptions are routing surfaces; long descriptions
// bloat token budgets. A simple word-count proxy flags files likely to
// exceed the waza 500-token limit (~1.55 tokens/word → 330 words ≈ 507 tokens).
const WORD_BUDGET = 330;
for (const s of skills) {
  const raw = fs.readFileSync(s.path, 'utf8');
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
  const wc = body.split(/\s+/).filter(Boolean).length;
  check(
    `${s.dir}: SKILL.md word count ${wc} <= ${WORD_BUDGET}`,
    wc <= WORD_BUDGET,
    `body is ${wc} words (~${Math.round(wc * 1.55)} tokens); trim to under ${WORD_BUDGET} words`
  );
}

// --- 6. Dead-link audit over README.md and docs/** -----------------------
function extractLocalLinks(file) {
  const text = fs.readFileSync(file, 'utf8');
  const links = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let href = m[1].split('#')[0];
    if (!href || /^(https?:|mailto:|npx)/.test(href)) continue;
    links.push(href);
  }
  return links;
}
const docFiles = [path.join(ROOT, 'README.md')];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) docFiles.push(p);
  }
})(path.join(ROOT, 'docs'));

let linkCount = 0;
for (const file of docFiles) {
  for (const href of extractLocalLinks(file)) {
    linkCount++;
    const target = path.resolve(path.dirname(file), decodeURIComponent(href));
    check(
      `link resolves: ${path.relative(ROOT, file)} -> ${href}`,
      fs.existsSync(target),
      `target not found on disk`
    );
  }
}
console.log(`\nChecked ${linkCount} local doc links.`);

// --- 7. Token-budget gate (word-count proxy, hard limit 500) ----------------
// Exact tokenization is waza's job; this is the local early-warning gate.
// Counts whitespace-normalized words after stripping frontmatter.
const TOKEN_HARD_LIMIT = 500;
for (const s of skills) {
  const raw = fs.readFileSync(s.path, 'utf8');
  const withoutFm = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const wordCount = withoutFm.split(/\s+/).filter(Boolean).length;
  check(
    `${s.dir}: SKILL.md word count ${wordCount} <= ${TOKEN_HARD_LIMIT}`,
    wordCount <= TOKEN_HARD_LIMIT,
    wordCount > TOKEN_HARD_LIMIT
      ? `exceeds hard limit by ${wordCount - TOKEN_HARD_LIMIT} words`
      : `${TOKEN_HARD_LIMIT - wordCount} words of headroom`
  );
}

if (failures > 0) {
  console.error(`\n❌ CONSISTENCY CHECK FAILED: ${failures} problem(s).`);
  process.exit(1);
}
console.log('\n🎉 ALL CONSISTENCY CHECKS PASSED.');
