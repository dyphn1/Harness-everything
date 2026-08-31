#!/usr/bin/env node
/**
 * Verify that paths named by each SKILL.md resolve inside the checked-out
 * package. This is intentionally separate from markdown-link checking:
 * commands, deep-dive paths, and executable examples are also routing API.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const EXTENSIONS = '(?:md|mdx|js|json|yaml|yml|txt)';
const PATH_TOKEN = new RegExp(`(?:<[^>]+>\\/)?(?:\\.{0,2}\\/)?[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*\\.${EXTENSIONS}\\b`, 'g');
const ROOT_PREFIXES = new Set([
  'hooks', 'harness-everything', 'to-spec', 'to-tickets', 'bin',
  'ci', 'skill-creator', 'self-evolve'
]);
const WORKSPACE_PREFIXES = new Set(['.claude', '.github', '.cursor', '.codex', '.continue', 'tasks', 'memories', 'specs', 'docs', 'evals']);

function discoverSkills(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

function discoverSkillDocuments(root, skillDirs = discoverSkills(root)) {
  const documents = [];
  for (const skillDir of skillDirs) {
    const base = path.join(root, skillDir);
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'SKILL.md') documents.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
    walk(base);
  }
  return documents.sort();
}

function extractCandidates(text) {
  const candidates = [];
  for (const line of text.split(/\r?\n/)) {
    const inCode = /`[^`]+`/.test(line);
    const contextPath = /(?:deep dive|guide|template|workflow|script|run|execute|path|file)/i.test(line);
    for (const match of line.matchAll(PATH_TOKEN)) {
      const raw = match[0].replace(/[),.;:]+$/, '');
      const hasSlash = raw.includes('/');
      if (inCode || contextPath || hasSlash || raw === 'SKILL.md') candidates.push(raw);
    }
  }
  return [...new Set(candidates)];
}

function resolveReference(root, skillDir, reference) {
  let ref = reference.replace(/\\/g, '/');
  if (ref.includes('<') && !ref.startsWith('<this-skill-dir>/') && !ref.startsWith('<skills-repo-root>/')) return null;
  ref = ref.replace(/^<this-skill-dir>\//, '').replace(/^<skills-repo-root>\//, '');
  if (ref.startsWith('./')) return path.resolve(root, skillDir, ref.slice(2));
  const first = ref.split('/')[0];
  if (!ref.includes('/')) {
    if (ref === 'SKILL.md') return path.resolve(root, skillDir, ref);
    if (fs.existsSync(path.join(root, ref))) return path.resolve(root, ref);
    if (fs.existsSync(path.join(root, skillDir, ref))) return path.resolve(root, skillDir, ref);
    return null;
  }
  if (ROOT_PREFIXES.has(first) || fs.existsSync(path.join(root, first, 'SKILL.md'))) {
    return path.resolve(root, ref);
  }
  if (WORKSPACE_PREFIXES.has(first)) return null;
  return path.resolve(root, skillDir, ref);
}

function checkSkillReferences(root, skillDirs = discoverSkills(root)) {
  const failures = [];
  let references = 0;
  for (const document of discoverSkillDocuments(root, skillDirs)) {
    const skillDir = path.posix.dirname(document);
    const skillPath = path.join(root, document);
    const candidates = extractCandidates(fs.readFileSync(skillPath, 'utf8'));
    for (const reference of candidates) {
      const target = resolveReference(root, skillDir, reference);
      if (!target) continue;
      references++;
      if (!fs.existsSync(target)) {
        failures.push({ skill: skillDir, reference, target: path.relative(root, target) });
      }
    }
  }
  return { failures, references };
}

function main() {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg === -1 ? DEFAULT_ROOT : path.resolve(process.argv[rootArg + 1]);
  const result = checkSkillReferences(root);
  for (const failure of result.failures) {
    console.error(`FAIL ${failure.skill}/SKILL.md -> ${failure.reference} (missing ${failure.target})`);
  }
  console.log(`Checked ${result.references} skill path reference(s) across ${discoverSkills(root).length} skill(s).`);
  if (result.failures.length) {
    console.error(`REFERENCE CHECK FAILED: ${result.failures.length} dangling reference(s).`);
    process.exit(1);
  }
  console.log('ALL SKILL REFERENCES RESOLVE.');
}

if (require.main === module) main();

module.exports = { discoverSkills, discoverSkillDocuments, extractCandidates, resolveReference, checkSkillReferences };
