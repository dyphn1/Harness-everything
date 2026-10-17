#!/usr/bin/env node
/**
 * Project Docs Framework Check
 *
 * Mechanized gate for `to-spec` (and `to-tickets`, once installed): has this
 * repo already pinned down where reference docs live, how issues are
 * tracked, and what counts as a valid issue? Read the validated project
 * configuration first; its project-docs.json file wholly overrides host
 * manifest values. Without it, host configuration is used only when selected
 * unambiguously by the shared resolver.
 *
 * Deliberately repo-local only: unlike self-evolve's `generated` skills
 * (intentionally reusable across projects), doc location / tracker / issue
 * definition are PER-REPO facts. Reading or writing them through the global
 * ~/.agents or ~/.claude manifest homes would leak one project's tracker
 * into every other project sharing that global install, so the resolver reads
 * only the workspace project file and workspace-relative platform manifests.
 *
 * Exit 0 -> a complete effective config or allowed workspace inference exists.
 * Exit 1 -> required fields are missing, or configuration is invalid/ambiguous.
 *           Run the Step 0 interview in to-spec/SKILL.md, then persist with `init`.
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
// Keep project-doc path decisions in the resolver carried by the installed
// multi-agent-workspace skill. This script consumes the same contract.
const { getWorkspaceRoot, getRepoManifestHomes, detectProjectDocsConventions } =
  require('./project-docs-resolver');

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
  // A standalone installed skill may not carry the package helper. Keep its
  // manifest format compatible with the package's tiny helper instead of
  // making document resolution depend on the source checkout.
  return {
    getManifestPath: home => path.join(home, 'harness-everything', 'manifest.json'),
    readManifest: file => {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(data.skills)) data.skills = [];
        if (!Array.isArray(data.agents)) data.agents = [];
        return data;
      } catch {
        return { package: 'harness-everything', skills: [], agents: [] };
      }
    },
    writeManifest: (file, data) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    }
  };
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

function missingFields(projectDocs) {
  if (!projectDocs) return REQUIRED_FIELDS.slice();
  return REQUIRED_FIELDS.filter(f => !String(projectDocs[f] || '').trim());
}

function detectWorkspaceConventions(workspaceRoot) {
  return detectProjectDocsConventions(workspaceRoot);
}

function runCheck(workspaceRoot) {
  // Selection and validation happen in the shared resolver. Invalid or
  // ambiguous sources cannot authorize a destination or fall through to a
  // different host; only `none` permits workspace convention inference.
  const effective = detectWorkspaceConventions(workspaceRoot);
  if (effective.status === 'invalid' || effective.status === 'ambiguous') {
    console.log(`[Project Docs Check] ${effective.status.toUpperCase()}: no usable projectDocs selection.`);
    for (const diagnostic of effective.diagnostics || []) {
      console.log(`  - ${diagnostic.code}: ${diagnostic.message} (${diagnostic.path})`);
    }
    process.exit(1);
  }

  const missing = missingFields(effective);
  if (missing.length === 0) {
    const source = effective.status === 'none'
      ? 'Inferred from workspace structure'
      : `Selected ${effective.status} projectDocs configuration`;
    console.log(`[Project Docs Check] OK (${source}):`);
    console.log(`  - docLocation: ${effective.docLocation}`);
    console.log(`  - tracker: ${effective.tracker}`);
    console.log(`  - issueDefinition: ${effective.issueDefinition}`);
    process.exit(0);
  }

  console.log(`[Project Docs Check] INCOMPLETE: selected config and allowed workspace inference do not cover all fields. Missing: ${missing.join(', ')}`);
  console.log('=> Run the Step 0 framework interview for missing fields, or proceed using default workspace fallbacks.');
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

if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log(`Gate: has this repo already pinned doc location / issue tracker / issue definition?

Usage:
  node check-project-docs.js [check]                                                Exit 0 for complete effective config or allowed inference; exit 1 for missing, invalid, or ambiguous config.
  node check-project-docs.js init --doc-location "..." --tracker "..." --issue-definition "..."
                                                                                       Persist all three fields (each <= ${MAX_FIELD_LENGTH} chars - a pointer, not the content) to every already-bootstrapped platform manifest.json in this repo.

Repo-local only: writes only to workspace-relative manifest homes (.claude/, .cursor/,
.github/, .codex/, .continue/), never to the user-home manifests self-evolve uses.`);
  process.exit(0);
}

const command = process.argv[2] || 'check';
const commandArgs = process.argv.slice(3);
const workspaceIndex = commandArgs.indexOf('--workspace');
// An explicit workspace is authoritative. Only the omitted flag walks up to
// the repository root; otherwise a nested target would silently resolve to
// its containing checkout and inspect the wrong project configuration.
if (workspaceIndex !== -1 && !commandArgs[workspaceIndex + 1]) {
  console.error('[Project Docs Check] --workspace requires a path');
  process.exit(1);
}
const workspaceRoot = workspaceIndex === -1
  ? getWorkspaceRoot()
  : path.resolve(commandArgs[workspaceIndex + 1]);
if (!workspaceRoot) {
  console.error('[to-spec/check-project-docs] Cannot inspect project docs without a resolved git workspace.');
  process.exit(1);
}

if (command === 'check') {
  runCheck(workspaceRoot);
} else if (command === 'init') {
  runInit(workspaceRoot, commandArgs);
} else {
  console.error(`[Project Docs Check] Unknown command "${command}". Use 'check' or 'init'.`);
  process.exit(1);
}
