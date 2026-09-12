#!/usr/bin/env node
/**
 * Deterministic route coverage gate for directly-routable skills plus an
 * explicit classification gate for nested skills. A new nested SKILL.md must
 * declare whether it is parent-routed or internal; otherwise CI fails instead
 * of silently ignoring it.
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

function expectedMarker(skill) {
  if (skill === 'harness-everything') return 'RECOMMENDED TIER';
  if (skill === 'todo-driven-workflow') return 'BASE EXECUTION LOOP';
  return `${skill}/SKILL.md`;
}

const skillDirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(ROOT, entry.name, 'SKILL.md')))
  .map(entry => entry.name)
  .sort();

let failures = 0;
let cases = 0;

const nestedOnDisk = skillDirs.flatMap(skill => discoverNestedSkills(path.join(ROOT, skill))).sort();
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
    const marker = expectedMarker(skill);
    if (result.status !== 0 || !output.includes(marker)) {
      console.error(`FAIL ${path.relative(ROOT, taskFile)}: expected "${marker}"`);
      failures++;
    } else {
      console.log(`PASS ${skill}/${path.basename(taskFile)}`);
    }
  }
}

console.log(`\nRoute coverage: ${cases} positive case(s) checked across ${skillDirs.length} direct skills; ${nestedOnDisk.length} nested skill(s) classified.`);
process.exit(failures ? 1 : 0);
