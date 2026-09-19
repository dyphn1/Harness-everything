#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { discoverSkills, extractCandidates } = require('./reference-check');
const {
  harnessReachableReferenceFiles,
  classifyReportedLink,
  normalizeSkillReport,
  normalizeReport,
  runCanonicalWazaChecks,
} = require('../scripts/waza-harness-check');

let passed = 0;
function check(value, message) {
  assert.ok(value, message);
  passed++;
  console.log('PASS ' + message);
}

const skills = discoverSkills(ROOT);
check(skills.length >= 20, 'discovers the canonical Harness skill set');

const invoked = [];
const fakeSpawn = (command, args, options) => {
  invoked.push({ command, args, cwd: options.cwd });
  const skillPath = args[1];
  const name = path.basename(skillPath);
  return {
    status: 0,
    stdout: JSON.stringify({
      timestamp: new Date(0).toISOString(),
      skills: [{
        name,
        path: path.join(skillPath, 'SKILL.md'),
        ready: true,
        compliance: { level: 'High' },
        tokenBudget: { exceeded: false },
        specCompliance: [],
        links: { passed: true },
      }],
    }),
    stderr: '',
  };
};
const scoped = runCanonicalWazaChecks(ROOT, 'waza', fakeSpawn);
check(scoped.skills.length === skills.length && invoked.length === skills.length,
  'adapter invokes Waza exactly once per canonical top-level skill');
check(invoked.every((call, index) =>
  call.command === 'waza' &&
  call.args[0] === 'check' &&
  call.args[1] === path.join(ROOT, skills[index]) &&
  call.args[2] === '--format' &&
  call.args[3] === 'json' &&
  call.cwd === ROOT),
  'Waza receives explicit canonical skill paths instead of recursive workspace discovery');

let skillsWithPlaceholderReferences = 0;
let totalResolved = 0;
for (const skill of skills) {
  const skillFile = path.join(ROOT, skill, 'SKILL.md');
  const text = fs.readFileSync(skillFile, 'utf8');
  const directReferenceTargets = extractCandidates(text)
    .filter(value => /^<this-skill-dir>\/references\//.test(value))
    .map(value => value.replace(/^<this-skill-dir>\//, ''));
  if (!directReferenceTargets.length) continue;

  skillsWithPlaceholderReferences++;
  const reachable = harnessReachableReferenceFiles(ROOT, skill);
  for (const target of directReferenceTargets) {
    check(reachable.has(target), skill + ' placeholder reference is reachable: ' + target);
  }

  const simulated = {
    name: skill,
    path: path.join(ROOT, skill),
    ready: false,
    compliance: { level: 'High' },
    tokenBudget: { exceeded: false },
    specCompliance: [{ name: 'spec-frontmatter', passed: true }],
    schema: { valid: true },
    links: {
      passed: false,
      orphanedFiles: [...new Set(directReferenceTargets)],
    },
  };
  const normalized = normalizeSkillReport(ROOT, simulated);
  check(normalized.harnessCompatibility.remainingOrphanedFiles.length === 0,
    skill + ' removes Waza orphan advisories for Harness-reachable references');
  check(normalized.harnessCompatibility.resolvedPlaceholderOrphans.length === new Set(directReferenceTargets).size,
    skill + ' reports the suppressed advisories explicitly');
  check(normalized.harnessCompatibility.harnessReady === true,
    skill + ' recomputes readiness without false local-orphan failures');
  totalResolved += normalized.harnessCompatibility.resolvedPlaceholderOrphans.length;
}

check(skillsWithPlaceholderReferences > 0, 'at least one canonical skill uses the Harness placeholder reference contract');
check(totalResolved > 0, 'adapter resolves canonical placeholder-orphan advisories');

const nestedReferenceContract = {
  'fable-mode': ['references/execution-phases.md'],
  'harness-everything': ['references/router-workflow-plan.md', 'references/skill-registry.md'],
  'multi-agent-workspace': ['references/agency-agents.md'],
  'skill-creator': [
    'references/authoring-workflow.md',
    'references/testing-workflow.md',
    'references/quality-principles.md',
    'references/dynamic-generation-contract.md',
  ],
  tdd: ['references/quality-model.md', 'references/unit-testing.md', 'references/integration-testing.md'],
};
for (const [skill, expected] of Object.entries(nestedReferenceContract)) {
  const reachable = harnessReachableReferenceFiles(ROOT, skill);
  for (const reference of expected) {
    check(reachable.has(reference), skill + ' nested reference remains reachable: ' + reference);
  }
  const normalized = normalizeSkillReport(ROOT, {
    name: skill,
    path: path.join(ROOT, skill),
    ready: false,
    compliance: { level: 'High' },
    tokenBudget: { exceeded: false },
    specCompliance: [],
    links: { passed: false, orphanedFiles: expected },
  });
  check(normalized.harnessCompatibility.remainingOrphanedFiles.length === 0,
    skill + ' nested reference advisories are resolved through the reachable reference graph');
}

const fableContract = classifyReportedLink(ROOT, 'fable-mode', {
  source: 'SKILL.md',
  target: '<skills-repo-root>/harness-everything/scripts/verify-gate.js',
  reason: 'link escapes skill directory',
});
check(fableContract.category === 'resolved-contract',
  '<skills-repo-root> existing target is a resolved Harness contract link');

const genericTemplate = classifyReportedLink(ROOT, 'repo-docs', {
  source: 'SKILL.md',
  target: '<workspace>/docs/generated.md',
  reason: 'target does not exist',
});
check(genericTemplate.category === 'template',
  'generic runtime placeholder is classified as a template advisory');

const badPlaceholder = classifyReportedLink(ROOT, 'repo-docs', {
  source: 'SKILL.md',
  target: '<this-folder>/references/missing.md',
  reason: 'target does not exist',
});
check(badPlaceholder.category === 'local',
  'unknown placeholder remains a real local-link problem');

const repoScopeLink = classifyReportedLink(ROOT, 'multi-agent-workspace', {
  source: 'workflows/01-init.md',
  target: '../../README.md#supported-ai-ides--tools',
  reason: 'link escapes skill directory',
});
check(repoScopeLink.category === 'resolved-contract' && repoScopeLink.issue.resolved === 'README.md',
  'existing repo-scope relative link is resolved by the Harness repository contract');

const missingRepoScopeLink = classifyReportedLink(ROOT, 'multi-agent-workspace', {
  source: 'workflows/01-init.md',
  target: '../../definitely-missing.md',
  reason: 'link escapes skill directory',
});
check(missingRepoScopeLink.category === 'local',
  'missing repo-scope relative link remains a hard local-link problem');

const templateLink = classifyReportedLink(ROOT, 'repo-docs', {
  source: 'templates/multi-skills-readme-template.md',
  target: './skills/category/{skill-name}/SKILL.md',
  reason: 'target does not exist',
});
check(templateLink.category === 'template',
  'links inside generated-document templates remain visible template advisories');

const synthetic = normalizeReport(ROOT, {
  timestamp: new Date(0).toISOString(),
  skills: [{
    name: 'harness-everything',
    path: path.join(ROOT, 'harness-everything'),
    ready: false,
    compliance: { level: 'High' },
    tokenBudget: { exceeded: false },
    specCompliance: [{ name: 'spec-frontmatter', passed: true }],
    links: {
      passed: false,
      orphanedFiles: ['references/triage-and-tiers.md'],
      deadURLs: [{ source: 'SKILL.md', target: 'https://example.invalid', reason: 'DNS lookup failed' }],
      brokenLinks: [{ source: 'SKILL.md', target: '<workspace>/generated.md', reason: 'target does not exist' }],
    },
  }],
});
const compatibility = synthetic.skills[0].harnessCompatibility;
check(compatibility.localLinksPassed === true,
  'network and generic-template findings do not masquerade as broken local links');
check(compatibility.networkAdvisories.length === 1 && compatibility.templateAdvisories.length === 1,
  'network and template findings are retained in separate advisory categories');
check(compatibility.harnessReady === true,
  'normalized readiness remains green when only false-orphan/network/template advisories remain');

const nonLinkFailure = normalizeSkillReport(ROOT, {
  name: 'repo-docs',
  path: path.join(ROOT, 'repo-docs'),
  ready: false,
  compliance: { level: 'Medium' },
  tokenBudget: { exceeded: true },
  specCompliance: [{ name: 'frontmatter', passed: false }],
  schema: { valid: false },
  links: { passed: true },
});
check(nonLinkFailure.harnessCompatibility.harnessReady === false &&
  nonLinkFailure.harnessCompatibility.nonLinkFailures.includes('compliance:Medium') &&
  nonLinkFailure.harnessCompatibility.nonLinkFailures.includes('token-budget-exceeded') &&
  nonLinkFailure.harnessCompatibility.nonLinkFailures.includes('spec:frontmatter') &&
  nonLinkFailure.harnessCompatibility.nonLinkFailures.includes('schema-invalid'),
  'non-link readiness failures remain explicit machine-readable blockers');

console.log('PASS: Waza/Harness reference adapter (' + passed + ' assertions across ' + skills.length + ' skills)');
