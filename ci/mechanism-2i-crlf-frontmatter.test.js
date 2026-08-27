#!/usr/bin/env node
/**
 * [2i] CRLF frontmatter immunity for quality gates.
 *
 * Regression guard for issue #5: every frontmatter parser in eval-framework
 * must tolerate CRLF line endings. A Windows clone (core.autocrlf=true) used
 * to produce 83 spurious consistency failures AND — worse — made the
 * collision check silently compare 27 empty descriptions and pass as a no-op.
 *
 * Method: copy the repo to a temp dir, convert every SKILL.md to CRLF, then:
 *   (a) consistency-check must PASS on the converted tree;
 *   (b) collision check must PASS unmodified;
 *   (c) negative control: plant a duplicated description pair -> collision
 *       check must FAIL. If parsing ever regresses to empty strings again,
 *       jaccard(NaN) trips nothing and this control goes red.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
let tmpRoot = null;

function check(name, condition, detail) {
  if (condition) {
    console.log(`✅ ${name}`);
    return true;
  }
  console.error(`❌ ${name}`);
  if (detail) console.error(`   ${detail}`);
  return false;
}

function listSkillMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) out.push(skillMd);
    const subDir = path.join(dir, entry.name);
    for (const sub of fs.readdirSync(subDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const nested = path.join(subDir, sub.name, 'SKILL.md');
      if (fs.existsSync(nested)) out.push(nested);
    }
  }
  return out;
}

function toCrlf(file) {
  const raw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, raw.replace(/\r?\n/g, '\r\n'), 'utf8');
}

function setDescription(file, newDesc) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const idx = lines.findIndex(l => l.replace(/\r$/, '').startsWith('description:'));
  if (idx === -1) throw new Error(`no description line in ${file}`);
  lines[idx] = `description: ${newDesc}`;
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function getDescription(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  return ((fm.match(/^description:\s*(.+)$/m) || [])[1] || '').trim();
}

function runGate(cwd, script) {
  const r = spawnSync(process.execPath, [path.join('eval-framework', script)], {
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

let failures = 0;

try {
  // Hermetic workspace: full repo copy minus VCS/deps.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crlf-test-'));
    fs.cpSync(projectRoot, tmpRoot, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(projectRoot, src);
      return !rel.split(path.sep)[0].match(/^(\.git|node_modules)$/);
    },
  });

  const skillMdFiles = listSkillMdFiles(tmpRoot);
  if (!check(
    '2i-pre. Found enough SKILL.md fixtures in copied tree',
    skillMdFiles.length >= 20,
    `Got ${skillMdFiles.length}`
  )) failures++;
  skillMdFiles.forEach(toCrlf);

  // (a) Consistency gate must survive a fully-CRLF working tree.
  const consistency = runGate(tmpRoot, 'consistency-check.js');
  if (!check(
    '2i-a. consistency-check passes on all-CRLF tree',
    consistency.code === 0 && consistency.stdout.includes('ALL CONSISTENCY CHECKS PASSED'),
    `exit=${consistency.code}, tail="${(consistency.stdout + consistency.stderr).trim().slice(-200)}"`
  )) failures++;

  // (b) Collision gate must pass unmodified...
  const collisionClean = runGate(tmpRoot, 'description-collision.js');
  if (!check(
    '2i-b. description-collision passes on all-CRLF tree',
    collisionClean.code === 0,
    `exit=${collisionClean.code}, tail="${(collisionClean.stdout + collisionClean.stderr).trim().slice(-200)}"`
  )) failures++;

  // (c) ...and must still be comparing REAL descriptions. Plant a duplicate:
  // if parsing regressed to empty strings, similarity would be NaN/0 and this
  // would silently pass — exactly the pre-fix failure mode.
  const donor = path.join(tmpRoot, 'tdd', 'SKILL.md');
  const target = path.join(tmpRoot, 'zoom-out', 'SKILL.md');
  setDescription(target, getDescription(donor));
  const collisionDup = runGate(tmpRoot, 'description-collision.js');
  if (!check(
    '2i-c. Negative control: planted CRLF duplicate FAILS collision check',
    collisionDup.code !== 0,
    `exit=${collisionDup.code} (a silent no-op parses empty descriptions and passes here), tail="${(collisionDup.stdout + collisionDup.stderr).trim().slice(-200)}"`
  )) failures++;
} catch (err) {
  failures++;
  console.error(`❌ 2i-setup. Test harness error: ${err.message}`);
} finally {
  if (tmpRoot) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
  }
}

if (failures > 0) process.exit(1);
console.log('\n[2i] CRLF frontmatter immunity: all checks passed.');
process.exit(0);
