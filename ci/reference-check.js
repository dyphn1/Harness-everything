#!/usr/bin/env node
/**
 * Verify that paths named by each SKILL.md resolve inside the checked-out
 * package. This is intentionally separate from markdown-link checking:
 * commands, deep-dive paths, and executable examples are also routing API.
 *
 * A path is relative to the file that names it. That is the default and needs
 * no ceremony - 'references/x.md' is this skill's own references/. Only a base
 * that is NOT the current file's directory needs a marker, so the common case
 * stays short and the exceptions are visible:
 *
 *   references/x.md                 this skill's directory (default; './', '../' work)
 *   skill-creator/SKILL.md          another skill - a first segment that is
 *                                   itself a skill, which is a fact about the
 *                                   repo rather than a hidden allowlist
 *   <skills-repo-root>/hooks/x.js   the root of this package
 *   <workspace>/tasks/todo.md       the USER's project - never checked here
 *
 * There is deliberately no allowlist of top-level directory names. 'ci/x.js'
 * used to silently resolve at the repo root while 'scripts/x.js' resolved
 * under the skill - two identical shapes with different bases, decided by a
 * list no author ever saw. Now both are skill-relative and the repo root is
 * spelled out.
 *
 * An unrecognised placeholder is a hard failure, not a silent skip: a typo
 * such as '<this_folder>/' used to make every path in a file invisible to
 * this gate, which is the opposite of what the gate is for.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const EXTENSIONS = '(?:md|mdx|js|json|yaml|yml|txt)';
const PATH_TOKEN = new RegExp(`(?:<[^>]+>\\/)?(?:\\.{0,2}\\/)?[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*\\.${EXTENSIONS}\\b`, 'g');
// Placeholder heads an author may write. A `resolvable` one is authoritative:
// whatever follows is joined onto that base and checked, and no other rule may
// override it. A `generic` one names something deliberately not a file in this
// repo, so it is recorded as intentional and never checked.
const RESOLVABLE_PLACEHOLDERS = {
  'this-skill-dir': (root, skillDir) => path.join(root, skillDir),
  'skills-repo-root': root => root,
};
const GENERIC_PLACEHOLDERS = new Set([
  'workspace',        // a path in the user's project, produced at runtime
  'skill',            // any skill, as a pattern
  'kebab-case-name',  // a skill yet to be created
]);

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

// Returns one of:
//   { status: 'check',   target }  resolve on disk and fail if missing
//   { status: 'skip' }             deliberately not a file in this repo
//   { status: 'invalid', reason }  malformed - fail and say why
function classifyReference(root, skillDir, reference) {
  const ref = reference.replace(/\\/g, '/');
  const head = ref.match(/^<([^>/]+)>\//);
  if (head) {
    const name = head[1];
    const rest = ref.slice(head[0].length);
    const base = RESOLVABLE_PLACEHOLDERS[name];
    // Authoritative: the placeholder alone decides the base. Nothing below
    // this line may relocate it to the repo root.
    if (base) return { status: 'check', target: path.resolve(base(root, skillDir), rest) };
    if (GENERIC_PLACEHOLDERS.has(name)) return { status: 'skip' };
    const known = Object.keys(RESOLVABLE_PLACEHOLDERS).map(k => '<' + k + '>/').join(' or ');
    return {
      status: 'invalid',
      reason: 'unknown placeholder <' + name + '>; use ' + known +
        ', or add <' + name + '> to GENERIC_PLACEHOLDERS if it names no file in this repo',
    };
  }
  // A placeholder anywhere else makes the token a pattern, not a path.
  if (ref.includes('<')) return { status: 'skip' };
  if (ref.startsWith('./')) return { status: 'check', target: path.resolve(root, skillDir, ref.slice(2)) };
  if (ref === 'SKILL.md') return { status: 'check', target: path.resolve(root, skillDir, ref) };
  // A bare filename with no directory is prose ("edit CONTEXT.md", "Node.js"),
  // too ambiguous to attach a base to. Write it with a placeholder to check it.
  if (!ref.includes('/')) return { status: 'skip' };
  // A first segment that is itself a skill is a fact about the repo, not a
  // hardcoded list, so cross-skill references stay readable.
  const first = ref.split('/')[0];
  if (fs.existsSync(path.join(root, first, 'SKILL.md'))) return { status: 'check', target: path.resolve(root, ref) };
  return { status: 'check', target: path.resolve(root, skillDir, ref) };
}

function resolveReference(root, skillDir, reference) {
  const result = classifyReference(root, skillDir, reference);
  return result.status === 'check' ? result.target : null;
}

function checkSkillReferences(root, skillDirs = discoverSkills(root)) {
  const failures = [];
  let references = 0;
  for (const document of discoverSkillDocuments(root, skillDirs)) {
    const skillDir = path.posix.dirname(document);
    const skillPath = path.join(root, document);
    const candidates = extractCandidates(fs.readFileSync(skillPath, 'utf8'));
    for (const reference of candidates) {
      const result = classifyReference(root, skillDir, reference);
      if (result.status === 'skip') continue;
      references++;
      if (result.status === 'invalid') {
        failures.push({ skill: skillDir, reference, target: result.reason });
      } else if (!fs.existsSync(result.target)) {
        failures.push({ skill: skillDir, reference, target: path.relative(root, result.target) });
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

module.exports = { discoverSkills, discoverSkillDocuments, extractCandidates, classifyReference, resolveReference, checkSkillReferences };
