#!/usr/bin/env node
/**
 * Project Docs Framework Check
 *
 * Mechanized gate for `to-spec` (and `to-tickets`, once installed): has this
 * repo already pinned down where reference docs live, how issues are
 * tracked, and what counts as a valid issue? Stored as a `projectDocs` entry
 * inside the SAME harness-everything/manifest.json this package already
 * owns (see scripts/lib/manifest.js and self-evolve's `generated` skill
 * registry) - not a new docs/agents/ file convention, so there's one config
 * surface, not two.
 *
 * Deliberately repo-local only: unlike self-evolve's `generated` skills
 * (intentionally reusable across projects), doc location / tracker / issue
 * definition are PER-REPO facts. Reading or writing them through the global
 * ~/.agents or ~/.claude manifest homes would leak one project's tracker
 * into every other project sharing that global install, so this script
 * scans only the workspace-relative platform homes, never the user-home ones.
 *
 * Exit 0 -> at least one detected platform's manifest.json (inside this
 *           repo) has a complete projectDocs entry. Read it, skip Step 0.
 * Exit 1 -> missing or incomplete everywhere. Run the Step 0 interview in
 *           to-spec/SKILL.md for the flagged field(s), then persist with `init`.
 *
 * manifest.json is read on every single tier-router.js invocation (every
 * prompt, not just to-spec runs) to scan for self-evolve's generated
 * skills - so projectDocs MUST stay a short pointer, never a growing log.
 * `init` enforces a length cap per field (see MAX_FIELD_LENGTH) precisely so
 * this can't quietly bloat over time. If a real answer is genuinely long
 * (a multi-context doc map, a full custom issue template), write that detail
 * into its own file - a CONTEXT-MAP.md entry, a `.github/ISSUE_TEMPLATE/`
 * file, a docs/ README - and pass just that path as the field's value.
 * Anything to-spec might later want to log per-session or per-doc (e.g.
 * "which doc got published for which conversation") belongs in a separate,
 * session-scoped file under the state dir (see hooks/scripts/lib/harness-
 * state.js's getSessionDir) - never appended into this manifest.
 */
const fs = require('fs');
const path = require('path');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadManifestHelper() {
  const candidates = [
    path.join(__dirname, '../../scripts/lib/manifest'),
    path.join(__dirname, '../scripts/lib/manifest'),
    path.join(__dirname, '../../../scripts/lib/manifest'),
    path.join(getWorkspaceRoot(), 'scripts/lib/manifest'),
    path.join(getWorkspaceRoot(), 'harness-everything/scripts/lib/manifest'),
  ];
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand + '.js') || fs.existsSync(cand)) {
        return require(cand);
      }
    } catch (e) {}
  }
  throw new Error('[to-spec/check-project-docs] Failed to locate manifest helper module (scripts/lib/manifest)');
}
const { getManifestPath, readManifest, writeManifest } = loadManifestHelper();

const REQUIRED_FIELDS = ['docLocation', 'tracker', 'issueDefinition'];
const FLAG_TO_FIELD = {
  'doc-location': 'docLocation',
  'tracker': 'tracker',
  'issue-definition': 'issueDefinition',
};
// A pointer, not a payload: one short line each. Long enough for "GitHub
// Issues via gh, label ready-for-agent" or "docs/reference/, see
// CONTEXT-MAP.md for per-context layout", too short for embedding a full
// issue template or a multi-paragraph doc-location policy inline.
const MAX_FIELD_LENGTH = 200;

// Workspace-relative platform homes ONLY - no userHome/.agents or
// userHome/.claude here (see file header). tier-router.js and
// register-dynamic-skill.js include those two because self-evolved skills
// are meant to travel with the user across projects; projectDocs must not.
function getRepoManifestHomes(workspaceRoot) {
  return [
    path.join(workspaceRoot, '.claude'),
    path.join(workspaceRoot, '.cursor'),
    path.join(workspaceRoot, '.github'),
    path.join(workspaceRoot, '.codex'),
    path.join(workspaceRoot, '.continue'),
  ];
}

function missingFields(projectDocs) {
  if (!projectDocs) return REQUIRED_FIELDS.slice();
  return REQUIRED_FIELDS.filter(f => !String(projectDocs[f] || '').trim());
}

function runCheck(workspaceRoot) {
  const existingPaths = getRepoManifestHomes(workspaceRoot)
    .map(getManifestPath)
    .filter(p => fs.existsSync(p));

  if (existingPaths.length === 0) {
    console.log('[Project Docs Check] MISSING: no harness-everything/manifest.json found for any detected platform in this repo.');
    console.log('=> Run the Step 0 framework interview (to-spec/SKILL.md), then persist with:');
    console.log('   node to-spec/scripts/check-project-docs.js init --doc-location "..." --tracker "..." --issue-definition "..."');
    process.exit(1);
  }

  // Any one manifest defining projectDocs fully is enough - init below
  // writes to every detected home together, so in practice they stay in sync.
  for (const manifestPath of existingPaths) {
    if (missingFields(readManifest(manifestPath).projectDocs).length === 0) {
      console.log(`[Project Docs Check] OK: ${manifestPath} defines document location, issue tracker, and issue definition.`);
      process.exit(0);
    }
  }

  // Report against whichever existing manifest is furthest along, so the
  // interview only needs to fill genuine gaps.
  const closest = existingPaths
    .map(p => ({ p, missing: missingFields(readManifest(p).projectDocs) }))
    .sort((a, b) => a.missing.length - b.missing.length)[0];

  console.log(`[Project Docs Check] INCOMPLETE: no manifest.json has a complete projectDocs entry. Closest is ${closest.p}, missing: ${closest.missing.join(', ')}`);
  console.log('=> Run the Step 0 framework interview for just the missing field(s), then re-run `init` to fill them in.');
  process.exit(1);
}

function parseFlags(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag && flag.startsWith('--') && value !== undefined) {
      values[flag.slice(2)] = value;
    }
  }
  return values;
}

function runInit(workspaceRoot, args) {
  const flags = parseFlags(args);
  const missingFlags = Object.keys(FLAG_TO_FIELD).filter(f => !flags[f]);
  if (missingFlags.length > 0) {
    console.error(`[Project Docs Check] init requires --${missingFlags.join(', --')}`);
    process.exit(1);
  }

  const oversizedFlags = Object.keys(FLAG_TO_FIELD).filter(f => flags[f].length > MAX_FIELD_LENGTH);
  if (oversizedFlags.length > 0) {
    for (const f of oversizedFlags) {
      console.error(`[Project Docs Check] --${f} is ${flags[f].length} chars - projectDocs fields must stay <= ${MAX_FIELD_LENGTH} chars (a pointer, not the content).`);
    }
    console.error('=> Write the detailed content to its own file instead (e.g. a CONTEXT-MAP.md entry, a .github/ISSUE_TEMPLATE/ file, a docs/ README), then pass just that path here.');
    process.exit(1);
  }

  const projectDocs = {
    docLocation: flags['doc-location'],
    tracker: flags['tracker'],
    issueDefinition: flags['issue-definition'],
    updatedAt: new Date().toISOString(),
  };

  const homes = getRepoManifestHomes(workspaceRoot);

  // Write to every platform home already bootstrapped with harness in THIS
  // repo (their harness-everything/ subfolder already exists), so switching
  // editors mid-project never loses this config.
  let wrote = 0;
  for (const home of homes) {
    const manifestPath = getManifestPath(home);
    if (!fs.existsSync(path.dirname(manifestPath))) continue;
    const data = readManifest(manifestPath);
    data.projectDocs = projectDocs;
    writeManifest(manifestPath, data);
    console.log(`[Project Docs Check] Wrote projectDocs to ${manifestPath}`);
    wrote++;
  }

  // No repo-local platform bootstrapped yet: create the primary one
  // (.claude/harness-everything/manifest.json) rather than falling back to
  // any global/user-home manifest - this data must never leave the repo.
  if (wrote === 0) {
    const manifestPath = getManifestPath(homes[0]);
    const data = readManifest(manifestPath);
    data.projectDocs = projectDocs;
    writeManifest(manifestPath, data);
    console.log(`[Project Docs Check] No platform bootstrapped yet in this repo - wrote projectDocs to ${manifestPath}`);
  }

  process.exit(0);
}

const command = process.argv[2] || 'check';
const workspaceRoot = getWorkspaceRoot();

if (command === 'check') {
  runCheck(workspaceRoot);
} else if (command === 'init') {
  runInit(workspaceRoot, process.argv.slice(3));
} else {
  console.error(`[Project Docs Check] Unknown command "${command}". Use 'check' or 'init'.`);
  process.exit(1);
}
