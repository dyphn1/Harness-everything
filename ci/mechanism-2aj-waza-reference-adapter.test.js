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
} = require('../scripts/waza-harness-check');

let passed = 0;
function check(value, message) {
  assert.ok(value, message);
  passed++;
  console.log('PASS ' + message);
}

const skills = discoverSkills(ROOT);
check(skills.length >= 20, 'discovers the canonical Harness skill set');

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

console.log('PASS: Waza/Harness reference adapter (' + passed + ' assertions across ' + skills.length + ' skills)');
