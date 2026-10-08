#!/usr/bin/env node
/**
 * Deterministic coverage gate for positive skill evals plus an explicit
 * classification gate for nested skills. The router may normalize prompt
 * signals, but it must not push canonical skill paths before an active step
 * binds them. A new nested SKILL.md must declare whether it is parent-routed
 * or internal; otherwise CI fails instead of silently ignoring it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const ROUTER = path.join(ROOT, 'harness-everything', 'scripts', 'tier-router.js');
const EVALS = path.join(ROOT, 'evals');

const NESTED_ROUTING = new Map([
  ['fable-mode/execution-guardrails', 'internal'],
  ['fable-mode/fable-haiku', 'parent'],
  ['fable-mode/fable-sonnet', 'parent'],
  ['fable-mode/fable-opus', 'parent'],
]);

function walkPositiveTasks(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkPositiveTasks(full));
    else if (/^positive.*\.ya?ml$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function discoverNestedSkills(skillDir) {
  const found = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, 'SKILL.md'))) found.push(path.relative(ROOT, child).replace(/\\/g, '/'));
      visit(child);
    }
  }
  visit(skillDir);
  return found;
}

const skillDirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(ROOT, entry.name, 'SKILL.md')))
  .map(entry => entry.name)
  .sort();

let failures = 0;
let cases = 0;

const nestedOnDisk = skillDirs.flatMap(skill => discoverNestedSkills(path.join(ROOT, skill))).sort();
const canonicalSkillPaths = [...skillDirs, ...nestedOnDisk]
  .map(skill => `${skill.replace(/\\/g, '/')}/SKILL.md`);
for (const nested of nestedOnDisk) {
  const classification = NESTED_ROUTING.get(nested);
  if (!classification) {
    console.error(`FAIL ${nested}/SKILL.md: nested skill has no explicit routing classification`);
    failures++;
  } else {
    console.log(`PASS ${nested}/SKILL.md: routing=${classification}`);
  }
}
for (const [nested, classification] of NESTED_ROUTING) {
  if (!nestedOnDisk.includes(nested)) {
    console.error(`FAIL routing classification ${nested}=${classification}: SKILL.md no longer exists`);
    failures++;
  }
}

for (const skill of skillDirs) {
  const skillText = fs.readFileSync(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
  const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let skillDescription;
  try {
    skillDescription = yaml.load(frontmatter[1]).description;
  } catch (error) {
    console.error(`FAIL ${skill}/SKILL.md: invalid frontmatter (${error.message})`);
    failures++;
    continue;
  }
  const taskFiles = walkPositiveTasks(path.join(EVALS, skill, 'tasks'));
  if (taskFiles.length === 0) {
    console.error(`FAIL ${skill}: no positive task files`);
    failures++;
    continue;
  }

  for (const taskFile of taskFiles) {
    cases++;
    let task;
    try {
      task = yaml.load(fs.readFileSync(taskFile, 'utf8'));
    } catch (error) {
      console.error(`FAIL ${path.relative(ROOT, taskFile)}: invalid YAML (${error.message})`);
      failures++;
      continue;
    }

    const prompt = task && task.inputs && task.inputs.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      console.error(`FAIL ${path.relative(ROOT, taskFile)}: missing inputs.prompt`);
      failures++;
      continue;
    }
    if (task.description !== skillDescription) {
      console.error(`FAIL ${path.relative(ROOT, taskFile)}: description does not exactly match SKILL.md frontmatter`);
      failures++;
      continue;
    }

    const result = spawnSync(process.execPath, [ROUTER, prompt], { cwd: ROOT, encoding: 'utf8' });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const missingPlanFields = [
      '=> RECOMMENDED TIER:',
      '=> WORKFLOW STRATEGY:',
    ].filter(marker => !output.includes(marker));
    const requestedNested = nestedOnDisk
      .filter(nested => NESTED_ROUTING.get(nested) === 'parent')
      .filter(nested => (task.tags || []).includes(path.posix.basename(nested)));
    const requiredParentPaths = requestedNested
      .map(nested => `${nested.split('/')[0]}/SKILL.md`);
    const missingParentPaths = requiredParentPaths.filter(skillPath => !output.includes(skillPath));
    const leakedPaths = canonicalSkillPaths
      .filter(skillPath => output.includes(skillPath) && !requiredParentPaths.includes(skillPath));
    if (result.status !== 0 || missingPlanFields.length || missingParentPaths.length || leakedPaths.length) {
      const reasons = [];
      if (result.status !== 0) reasons.push(`router exited ${result.status}`);
      if (missingPlanFields.length) reasons.push(`missing ${missingPlanFields.join(', ')}`);
      if (missingParentPaths.length) reasons.push(`missing explicit parent route: ${missingParentPaths.join(', ')}`);
      if (leakedPaths.length) reasons.push(`pre-step skill paths leaked: ${leakedPaths.join(', ')}`);
      console.error(`FAIL ${path.relative(ROOT, taskFile)}: ${reasons.join('; ')}`);
      failures++;
    } else {
      console.log(`PASS ${skill}/${path.basename(taskFile)}: matching positive eval accepted with only explicit parent bindings`);
    }
  }
}

console.log(`\nPositive skill-eval coverage: ${cases} case(s) checked across ${skillDirs.length} direct skills; ${nestedOnDisk.length} nested skill(s) classified.`);
process.exit(failures ? 1 : 0);
