#!/usr/bin/env node
/**
 * Deterministic route coverage gate for every skill's positive eval prompts.
 * This complements waza: it executes the real local tier-router and does not
 * require a network-installed evaluator.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const ROUTER = path.join(ROOT, 'harness-everything', 'scripts', 'tier-router.js');
const EVALS = path.join(ROOT, 'evals');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/^positive.*\.ya?ml$/i.test(entry.name)) files.push(full);
  }
  return files;
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
  const taskFiles = walk(path.join(EVALS, skill, 'tasks'));
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

    const result = spawnSync(process.execPath, [ROUTER, prompt], {
      cwd: ROOT,
      encoding: 'utf8',
    });
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

console.log(`\nRoute coverage: ${cases - failures}/${cases} positive cases passed across ${skillDirs.length} skills.`);
process.exit(failures ? 1 : 0);
