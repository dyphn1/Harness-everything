#!/usr/bin/env node
/**
 * Progressive-disclosure checks for the skill catalog.
 *
 * The top-level SKILL.md is the routed contract. Workflow docs explain the
 * behavior in plain language, and references/guides hold detail that is
 * loaded only when needed. Keeping these checks separate makes the policy
 * usable from consistency-check.js and from focused mechanism tests.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MIN_MERMAID = 1;

function discoverSkills(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

function discoverWorkflowDocs(root) {
  const dir = path.join(root, 'docs', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.slice(0, -3))
    .sort();
}

function bodyWithoutFrontmatter(raw) {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function mermaidBlocks(text) {
  const blocks = [];
  const re = /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/gi;
  let match;
  while ((match = re.exec(text)) !== null) blocks.push(match[1].trim());
  return blocks;
}

function isMeaningfulMermaid(block) {
  if (!block) return false;
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const source = lines.slice(1).join('\n');
  const edges = (source.match(/(?:-->|->>|-.->|==>|---)/g) || []).length;
  return edges >= 1;
}

function deepDivePointers(body) {
  const pointers = [];
  const re = /^Deep dive:\s*(.+)$/gim;
  let match;
  while ((match = re.exec(body)) !== null) {
    const line = match[1]
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2')
      .replace(/`/g, '');
    pointers.push(...line.split(/\s+\+\s+/).map(value => value.trim()).filter(Boolean));
  }
  return pointers;
}

function cleanPointer(pointer) {
  return pointer.replace(/[),.;:]+$/, '').trim();
}

function pointerTarget(root, skill, pointer, skillDirs) {
  const clean = cleanPointer(pointer);
  const match = clean.match(/^<([^>/]+)>\/(.*)$/);
  if (match && match[1] === 'skills-repo-root') return path.resolve(root, match[2]);
  if (match && match[1] === 'this-skill-dir') return path.resolve(root, skill, match[2]);
  const first = clean.split('/')[0];
  if (skillDirs.includes(first)) return path.resolve(root, clean);
  return path.resolve(root, skill, clean);
}

function pointerResolves(root, skill, pointer, skillDirs) {
  const clean = cleanPointer(pointer);
  const wildcard = clean.search(/[?*[]/);
  const target = pointerTarget(root, skill, wildcard === -1 ? clean : clean.slice(0, wildcard), skillDirs);
  if (!fs.existsSync(target)) return false;
  if (wildcard === -1) return true;
  if (!fs.statSync(target).isDirectory()) return false;
  return fs.readdirSync(target).length > 0;
}

function checkDisclosure(root = DEFAULT_ROOT, options = {}) {
  const minMermaid = options.minMermaid === undefined ? DEFAULT_MIN_MERMAID : options.minMermaid;
  const skills = discoverSkills(root);
  const workflows = discoverWorkflowDocs(root);
  const failures = [];
  const add = (check, detail) => failures.push({ check, detail });

  const skillSet = new Set(skills);
  for (const skill of skills) {
    const skillPath = path.join(root, skill, 'SKILL.md');
    const raw = fs.readFileSync(skillPath, 'utf8');
    const body = bodyWithoutFrontmatter(raw);
    const refsDir = path.join(root, skill, 'references');
    if (!fs.existsSync(refsDir) || !fs.statSync(refsDir).isDirectory()) {
      add(`${skill}: references directory`, 'missing references/ for lazy-loaded detail');
    }

    const pointers = deepDivePointers(body);
    if (pointers.length === 0) {
      add(`${skill}: Deep dive pointer`, 'SKILL.md must name one lazy-loaded entry point');
    } else {
      for (const pointer of pointers) {
        if (!pointerResolves(root, skill, pointer, skills)) {
          add(`${skill}: Deep dive pointer resolves`, `${pointer} does not resolve from ${skill}/SKILL.md`);
        }
      }
    }

    if (/```mermaid\b/i.test(body)) {
      add(`${skill}: no Mermaid in SKILL.md`, 'put diagram source in docs/workflows/<skill>.md');
    }
  }

  for (const skill of skills) {
    const workflowPath = path.join(root, 'docs', 'workflows', `${skill}.md`);
    if (!fs.existsSync(workflowPath)) {
      add(`${skill}: workflow document`, `missing docs/workflows/${skill}.md`);
      continue;
    }
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const blocks = mermaidBlocks(workflow);
    if (blocks.length < minMermaid) {
      add(`${skill}: Mermaid coverage`, `${blocks.length} fence(s); requires at least ${minMermaid}`);
    }
    if (blocks.some(block => !isMeaningfulMermaid(block))) {
      add(`${skill}: meaningful Mermaid coverage`, 'each Mermaid fence needs nodes and at least one transition');
    }
  }

  for (const workflow of workflows) {
    if (!skillSet.has(workflow)) {
      add(`${workflow}: workflow pairing`, `orphan docs/workflows/${workflow}.md`);
    }
  }

  return { failures, skills, workflows, minMermaid };
}

function main() {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg === -1 ? DEFAULT_ROOT : path.resolve(process.argv[rootArg + 1]);
  const result = checkDisclosure(root);
  for (const failure of result.failures) console.error(`FAIL ${failure.check}: ${failure.detail}`);
  console.log(`Checked disclosure for ${result.skills.length} skill(s) and ${result.workflows.length} workflow doc(s).`);
  if (result.failures.length) {
    console.error(`DISCLOSURE CHECK FAILED: ${result.failures.length} problem(s).`);
    process.exit(1);
  }
  console.log('ALL DISCLOSURE CHECKS PASSED.');
}

if (require.main === module) main();

module.exports = {
  bodyWithoutFrontmatter,
  checkDisclosure,
  deepDivePointers,
  discoverSkills,
  discoverWorkflowDocs,
  isMeaningfulMermaid,
  mermaidBlocks,
  pointerResolves,
};
