#!/usr/bin/env node
/**
 * Compare the checked-out skill catalog and SKILL.md path references with a
 * named release tag. This keeps a release-to-release file-tree claim backed by
 * Git objects instead of by the current working tree alone.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { discoverSkills, extractCandidates, checkSkillReferences } = require('./reference-check');

const root = path.resolve(__dirname, '..');
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex === -1 ? 'v0.3.3-beta' : process.argv[tagIndex + 1];
const ignoredPrefixes = new Set(['.claude', '.github', '.cursor', '.codex', '.continue', 'tasks', 'memories', 'specs', 'docs', 'evals']);
const rootPrefixes = new Set(['hooks', 'harness-everything', 'to-spec', 'to-tickets', 'bin', 'ci', 'skill-creator', 'self-evolve']);

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function tagFiles(scope) {
  return new Set(git(['ls-tree', '-r', '--name-only', tag, '--', scope]).split(/\r?\n/).filter(Boolean));
}

function tagSkills() {
  return git(['ls-tree', '-d', '--name-only', tag]).split(/\r?\n/)
    .filter(name => name && !name.startsWith('.') && tagFiles(name).has(`${name}/SKILL.md`));
}

function currentFiles(scope) {
  const result = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result.add(path.relative(path.join(root, scope), full).replace(/\\/g, '/'));
    }
  }
  walk(path.join(root, scope));
  return result;
}

function resolveTagReference(skillDir, reference, allFiles) {
  let ref = reference.replace(/\\/g, '/');
  if (ref.includes('<') && !ref.startsWith('<this-skill-dir>/') && !ref.startsWith('<skills-repo-root>/')) return null;
  ref = ref.replace(/^<this-skill-dir>\//, '').replace(/^<skills-repo-root>\//, '');
  if (!ref.includes('/')) return allFiles.has(ref) ? ref : (allFiles.has(`${skillDir}/${ref}`) ? `${skillDir}/${ref}` : null);
  if (ref.startsWith('./') || ref.startsWith('../')) return path.posix.normalize(`${skillDir}/${ref}`);
  const first = ref.split('/')[0];
  if (ignoredPrefixes.has(first)) return null;
  if (rootPrefixes.has(first) || allFiles.has(`${first}/SKILL.md`)) return ref;
  return `${skillDir}/${ref}`;
}

function main() {
  let tagRoot;
  try {
    tagRoot = tagSkills();
  } catch (err) {
    console.error(`Release tag ${tag} is unavailable: ${err.message.trim()}`);
    process.exit(2);
  }
  const current = new Set(discoverSkills(root));
  const missing = [...tagRoot].filter(skill => !current.has(skill));
  const extra = [...current].filter(skill => !tagRoot.includes(skill));
  console.log(`Release ${tag}: ${tagRoot.length} skill(s); current tree: ${current.size} skill(s).`);
  if (missing.length || extra.length) {
    if (missing.length) console.error(`Missing from current tree: ${missing.join(', ')}`);
    if (extra.length) console.error(`Not present in release tag: ${extra.join(', ')}`);
    process.exit(1);
  }

  let references = 0;
  let failures = 0;
  const allFiles = new Set(git(['ls-tree', '-r', '--name-only', tag]).split(/\r?\n/).filter(Boolean));
  const tagDocuments = [...allFiles]
    .filter(file => file.endsWith('/SKILL.md'))
    .filter(file => tagRoot.includes(file.split('/')[0]));
  for (const document of tagDocuments) {
    const skill = path.posix.dirname(document);
    const skillText = git(['show', `${tag}:${document}`]);
    for (const reference of extractCandidates(skillText)) {
      const resolved = resolveTagReference(skill, reference, allFiles);
      if (!resolved) continue;
      references++;
      if (!allFiles.has(resolved)) {
        console.warn(`BASELINE NOTE ${skill}/SKILL.md -> ${reference} (missing ${resolved} in ${tag})`);
        failures++;
      }
    }
  }
  for (const skill of tagRoot) {
    const files = tagFiles(skill);
    const sourceFiles = currentFiles(skill);
    console.log(`  ${skill}: ${files.size} file(s) in ${tag}; ${sourceFiles.size} file(s) in current source`);
  }
  console.log(`Checked ${references} release-tag skill reference(s).`);
  if (failures) {
    console.warn(`RELEASE BASELINE NOTE: ${failures} historical reference(s) in ${tag} do not resolve; current-tree references are gated separately.`);
  }
  const currentReferences = checkSkillReferences(root);
  console.log(`Checked ${currentReferences.references} current skill path reference(s).`);
  for (const failure of currentReferences.failures) {
    console.error(`CURRENT FAIL ${failure.skill}/SKILL.md -> ${failure.reference} (missing ${failure.target})`);
  }
  if (currentReferences.failures.length) {
    console.error(`CURRENT RELEASE CHECK FAILED: ${currentReferences.failures.length} dangling reference(s).`);
    process.exit(1);
  }
  console.log(`RELEASE SKILL CATALOG PASSED for ${tag}; current source has the same ${tagRoot.length} skill directories.`);
}

if (require.main === module) main();
