#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  discoverSkills,
  extractCandidates,
  classifyReference,
  checkSkillReferences,
} = require('../ci/reference-check');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const READY_COMPLIANCE = new Set(['Medium-High', 'High']);

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function decodeTarget(value) {
  const raw = String(value || '');
  try { return decodeURIComponent(raw); }
  catch (_) { return raw; }
}

function unwrapMarkdownDestination(value) {
  const target = String(value || '').trim();
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
}

function markdownLinkTargets(text) {
  const targets = [];
  for (const match of String(text || '').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = unwrapMarkdownDestination(match[1]);
    if (target) targets.push(target);
  }
  return targets;
}

function harnessReachableReferenceFiles(root, skillName) {
  const skillRoot = path.join(root, skillName);
  const rootKey = path.resolve(skillRoot);
  const queue = ['SKILL.md'];
  const visited = new Set();
  const reachable = new Set();

  while (queue.length) {
    const relativeDoc = slash(queue.shift());
    if (visited.has(relativeDoc)) continue;
    visited.add(relativeDoc);

    const full = path.resolve(skillRoot, relativeDoc);
    if (!full.startsWith(rootKey + path.sep) && full !== rootKey) continue;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;

    const text = fs.readFileSync(full, 'utf8');
    const docDir = path.dirname(full);

    for (const reference of extractCandidates(text)) {
      const classified = classifyReference(root, skillName, reference);
      if (classified.status !== 'check' || !fs.existsSync(classified.target)) continue;
      const relToSkill = slash(path.relative(skillRoot, classified.target));
      if (!relToSkill.startsWith('../') && relToSkill !== '..') {
        if (relToSkill.startsWith('references/')) reachable.add(relToSkill);
        if (/\.mdx?$/i.test(relToSkill)) queue.push(relToSkill);
      }
    }

    for (const targetRaw of markdownLinkTargets(text)) {
      const target = decodeTarget(targetRaw).split('#', 1)[0];
      if (!target || /^(?:https?:|mailto:|mdc:)/i.test(target)) continue;
      if (/^<[^>]+>\//.test(target)) {
        const classified = classifyReference(root, skillName, target);
        if (classified.status !== 'check' || !fs.existsSync(classified.target)) continue;
        const relToSkill = slash(path.relative(skillRoot, classified.target));
        if (!relToSkill.startsWith('../') && relToSkill !== '..') {
          if (relToSkill.startsWith('references/')) reachable.add(relToSkill);
          if (/\.mdx?$/i.test(relToSkill)) queue.push(relToSkill);
        }
        continue;
      }
      const resolved = path.resolve(docDir, target);
      const relToSkill = slash(path.relative(skillRoot, resolved));
      if (relToSkill === '..' || relToSkill.startsWith('../')) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
      if (relToSkill.startsWith('references/')) reachable.add(relToSkill);
      if (/\.mdx?$/i.test(relToSkill)) queue.push(relToSkill);
    }
  }
  return reachable;
}

function classifyReportedLink(root, skillName, issue) {
  const target = unwrapMarkdownDestination(decodeTarget(issue && issue.target));
  if (!target) return { category: 'local', issue };
  const source = slash(issue && issue.source || 'SKILL.md');

  // Files under templates/ describe paths that exist only after generation.
  // Keep Waza's finding visible, but do not confuse template output paths with
  // broken links in the checked-in skill itself.
  if (source === 'templates' || source.startsWith('templates/')) {
    return { category: 'template', issue: { ...issue, target } };
  }

  if (/^<[^>]+>\//.test(target)) {
    const classified = classifyReference(root, skillName, target);
    if (classified.status === 'skip') {
      return { category: 'template', issue: { ...issue, target } };
    }
    if (classified.status === 'check' && fs.existsSync(classified.target)) {
      return {
        category: 'resolved-contract',
        issue: { ...issue, target, resolved: slash(path.relative(root, classified.target)) },
      };
    }
  }

  // Waza intentionally treats links that escape a skill directory as scope
  // findings. Harness permits those links only when they resolve to a real
  // checked-in path inside this repository. Missing/outside paths remain hard
  // local failures.
  const targetPath = target.split('#', 1)[0];
  if (/^\.\.?(?:\/|$)/.test(targetPath)) {
    const repoRoot = path.resolve(root);
    const sourceFile = path.resolve(repoRoot, skillName, source);
    const resolved = path.resolve(path.dirname(sourceFile), targetPath);
    const relative = path.relative(repoRoot, resolved);
    const insideRepo = relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    if (insideRepo && fs.existsSync(resolved)) {
      return {
        category: 'resolved-contract',
        issue: { ...issue, target, resolved: slash(relative) },
      };
    }
  }

  return { category: 'local', issue: { ...issue, target } };
}

function nonLinkFailureReasons(skill) {
  const reasons = [];
  const compliance = skill?.compliance?.level;
  if (!READY_COMPLIANCE.has(compliance)) reasons.push('compliance:' + (compliance || 'missing'));
  if (skill?.tokenBudget?.exceeded === true) reasons.push('token-budget-exceeded');
  for (const item of skill?.specCompliance || []) {
    if (item.passed === false) reasons.push('spec:' + (item.name || 'unnamed'));
  }
  if (skill?.schema && skill.schema.valid === false) reasons.push('schema-invalid');
  return reasons;
}

function nonLinkReady(skill) {
  return nonLinkFailureReasons(skill).length === 0;
}

function normalizeSkillReport(root, skill) {
  const skillName = skill.name || path.basename(skill.path || '');
  const links = skill.links || {};
  const reachable = harnessReachableReferenceFiles(root, skillName);

  const resolvedPlaceholderOrphans = [];
  const remainingOrphanedFiles = [];
  for (const orphan of links.orphanedFiles || []) {
    const normalized = slash(orphan);
    if (reachable.has(normalized)) resolvedPlaceholderOrphans.push(normalized);
    else remainingOrphanedFiles.push(normalized);
  }

  const resolvedContractLinks = [];
  const templateAdvisories = [];
  const remainingLocalLinkIssues = [];
  for (const [kind, items] of [
    ['broken', links.brokenLinks || []],
    ['directory', links.directoryLinks || []],
    ['scope', links.scopeEscapes || []],
  ]) {
    for (const issue of items) {
      const classified = classifyReportedLink(root, skillName, issue);
      const entry = { kind, ...classified.issue };
      if (classified.category === 'resolved-contract') resolvedContractLinks.push(entry);
      else if (classified.category === 'template') templateAdvisories.push(entry);
      else remainingLocalLinkIssues.push(entry);
    }
  }

  const networkAdvisories = (links.deadURLs || []).map(issue => ({ kind: 'network', ...issue }));
  const localLinksPassed = remainingLocalLinkIssues.length === 0 && remainingOrphanedFiles.length === 0;
  const harnessReady = nonLinkReady(skill) && localLinksPassed;

  return {
    ...skill,
    harnessCompatibility: {
      wazaReady: Boolean(skill.ready),
      harnessReady,
      localLinksPassed,
      nonLinkFailures: nonLinkFailureReasons(skill),
      resolvedPlaceholderOrphans,
      resolvedContractLinks,
      templateAdvisories,
      networkAdvisories,
      remainingLocalLinkIssues,
      remainingOrphanedFiles,
    },
  };
}

function normalizeReport(root, report) {
  return {
    ...report,
    harnessReferenceContract: {
      version: 1,
      resolvablePlaceholders: ['this-skill-dir', 'skills-repo-root'],
      genericPlaceholders: ['workspace', 'skill', 'kebab-case-name'],
    },
    skills: (report.skills || []).map(skill => normalizeSkillReport(root, skill)),
  };
}

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, waza: process.env.WAZA_BIN || 'waza', format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--root') args.root = path.resolve(argv[++i]);
    else if (value === '--waza') args.waza = argv[++i];
    else if (value === '--format') args.format = argv[++i];
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error('unknown argument: ' + value);
  }
  if (!['text', 'json'].includes(args.format)) throw new Error('--format must be text or json');
  return args;
}

function printText(report) {
  let harnessReady = 0;
  let localPass = 0;
  let resolvedOrphans = 0;
  let network = 0;
  let templates = 0;
  for (const skill of report.skills || []) {
    const h = skill.harnessCompatibility;
    if (h.harnessReady) harnessReady++;
    if (h.localLinksPassed) localPass++;
    resolvedOrphans += h.resolvedPlaceholderOrphans.length;
    network += h.networkAdvisories.length;
    templates += h.templateAdvisories.length;
    const icon = h.localLinksPassed ? 'PASS' : 'FAIL';
    process.stdout.write(
      `${icon} ${skill.name}: local-links=${h.localLinksPassed ? 'ok' : 'broken'}` +
      ` harness-ready=${h.harnessReady ? 'yes' : 'no'}` +
      ` nonlink=${h.nonLinkFailures.length ? h.nonLinkFailures.join(',') : 'ok'}` +
      ` resolved-placeholder-orphans=${h.resolvedPlaceholderOrphans.length}` +
      ` network-advisories=${h.networkAdvisories.length}` +
      ` template-advisories=${h.templateAdvisories.length}\n`
    );
    for (const issue of h.remainingLocalLinkIssues) {
      process.stdout.write(`  LOCAL ${issue.kind}: ${issue.source || 'SKILL.md'} -> ${issue.target} (${issue.reason || 'unresolved'})\n`);
    }
    for (const orphan of h.remainingOrphanedFiles) {
      process.stdout.write(`  ORPHAN ${orphan}\n`);
    }
  }
  const total = (report.skills || []).length;
  process.stdout.write(
    `Harness/Waza compatibility: local-link-pass ${localPass}/${total}; ` +
    `harness-ready ${harnessReady}/${total}; resolved false orphan advisories ${resolvedOrphans}; ` +
    `network advisories ${network}; template advisories ${templates}.\n`
  );
}

function runCanonicalWazaChecks(root, waza, spawn = spawnSync) {
  const skillNames = discoverSkills(root);
  const skills = [];
  let timestamp = null;

  for (const skillName of skillNames) {
    const skillPath = path.join(root, skillName);
    const result = spawn(waza, ['check', skillPath, '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, WAZA_NO_UPDATE_CHECK: '1' },
    });
    if (result.error) {
      throw new Error('cannot execute waza for ' + skillName + ': ' + result.error.message);
    }
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim();
      throw new Error('waza check failed for ' + skillName + ' with exit ' + result.status +
        (detail ? ': ' + detail : ''));
    }

    let raw;
    try {
      raw = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error('invalid waza JSON output for ' + skillName + ': ' + error.message);
    }
    if (!Array.isArray(raw.skills) || raw.skills.length !== 1) {
      throw new Error('waza check for ' + skillName + ' did not return exactly one skill report');
    }
    timestamp = timestamp || raw.timestamp || null;
    skills.push(raw.skills[0]);
  }

  return {
    timestamp: timestamp || new Date().toISOString(),
    skills,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('[Waza Harness Adapter] ' + error.message);
    process.exit(2);
  }
  if (args.help) {
    console.log('Usage: node scripts/waza-harness-check.js [--root <repo>] [--waza <binary>] [--format text|json]');
    process.exit(0);
  }

  const canonical = checkSkillReferences(args.root);
  if (canonical.failures.length) {
    for (const failure of canonical.failures) {
      console.error(`[Waza Harness Adapter] unresolved Harness reference: ${failure.skill} -> ${failure.reference} (${failure.target})`);
    }
    process.exit(1);
  }

  let raw;
  try {
    raw = runCanonicalWazaChecks(args.root, args.waza);
  } catch (error) {
    console.error('[Waza Harness Adapter] ' + error.message);
    process.exit(2);
  }

  const normalized = normalizeReport(args.root, raw);
  if (args.format === 'json') process.stdout.write(JSON.stringify(normalized, null, 2) + '\n');
  else printText(normalized);

  const failed = normalized.skills.some(skill => !skill.harnessCompatibility.harnessReady);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  unwrapMarkdownDestination,
  markdownLinkTargets,
  harnessReachableReferenceFiles,
  classifyReportedLink,
  nonLinkFailureReasons,
  nonLinkReady,
  normalizeSkillReport,
  normalizeReport,
  runCanonicalWazaChecks,
};
