const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2q] Global scope: canonical store reuses the pre-existing shared ~/.agents/skills (issue #49)...');

const skills = require('../scripts/lib/skills');
const manifest = require('../scripts/lib/manifest');

const harnessSourceDir = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2q-home-'));
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2q-ws-'));

// Mirrors what cursor.js/codex.js/continue.js/copilot.js/hermes.js's
// getSkillsTarget({isGlobal:true}) all independently return today: the SAME
// path + SAME manifest, deduped in installer.js's main() into one targetDirs
// entry before installSkillsToTargets ever runs.
const globalAgentsDir = path.join(home, '.agents');
const sharedTarget = {
  path: path.join(globalAgentsDir, 'skills'),
  label: '~/.agents/skills/',
  manifestPath: manifest.getManifestPath(globalAgentsDir),
};
// claude.js's global target is separate: ~/.claude/skills/.
const claudeGlobalTarget = {
  path: path.join(home, '.claude', 'skills'),
  label: '~/.claude/skills/',
  manifestPath: manifest.getManifestPath(path.join(home, '.claude')),
};

const canonicalDir = skills.getCanonicalSkillsDir({ isGlobal: true, workspaceRoot: ws, userHome: home });
helper.check(
  '2q. global canonical dir IS the pre-existing shared ~/.agents/skills path, not a new location',
  canonicalDir === sharedTarget.path,
  `canonicalDir=${canonicalDir} sharedTarget.path=${sharedTarget.path}`
);

skills.installSkillsToTargets({
  chosenSkills: ['tdd'],
  targetDirs: [sharedTarget, claudeGlobalTarget],
  harnessSourceDir,
  packageVersion: '9.9.9',
  canonicalDir,
  linkMode: 'auto',
});

const sharedSkillDir = path.join(sharedTarget.path, 'tdd');
const claudeSkillDir = path.join(claudeGlobalTarget.path, 'tdd');

helper.check(
  '2q. the shared target (cursor/codex/continue/copilot/hermes stand-in) gets the PHYSICAL copy, not a link to itself',
  fs.existsSync(sharedSkillDir) && !skills.isLinkPath(sharedSkillDir),
  `exists=${fs.existsSync(sharedSkillDir)} isLink=${skills.isLinkPath(sharedSkillDir)}`
);
helper.check(
  "2q. Claude's separate global target links into the shared store instead of duplicating it",
  skills.isLinkPath(claudeSkillDir),
  `isLink=${skills.isLinkPath(claudeSkillDir)}`
);

const sharedManifestEntry = manifest.readManifest(sharedTarget.manifestPath).skills.find(s => s.id === 'tdd');
helper.check(
  '2q. the shared-store manifest entry records a plain copy (no kind/canonicalPath)',
  sharedManifestEntry && !sharedManifestEntry.kind && !sharedManifestEntry.canonicalPath,
  `Got: ${JSON.stringify(sharedManifestEntry)}`
);

// --- Removing Claude's link must NOT delete the shared store: 5 other
// platforms still depend on it directly (their own manifest row IS that
// path), even though nothing else "links" to it. ---
{
  const installed = skills.getInstalledSkills(ws, home);
  const claudeEntry = installed.find(s => s.dirPath === claudeSkillDir);
  skills.removeSkill(claudeEntry, { workspaceRoot: ws, userHome: home });

  helper.check(
    "2q. removing Claude's link leaves the shared store intact (still independently in use)",
    !fs.existsSync(claudeSkillDir) && fs.existsSync(sharedSkillDir),
    `claude exists=${fs.existsSync(claudeSkillDir)} shared exists=${fs.existsSync(sharedSkillDir)}`
  );
}

// --- Removing the shared store directly must also clean up any dependent
// link (symmetric case - re-link Claude first to set this up). ---
{
  skills.installSkillsToTargets({
    chosenSkills: ['tdd'],
    targetDirs: [claudeGlobalTarget],
    harnessSourceDir,
    packageVersion: '9.9.9',
    canonicalDir,
    linkMode: 'auto',
  });
  helper.check('2q. (setup) Claude re-linked to the shared store', skills.isLinkPath(claudeSkillDir), 'relink failed');

  const installed = skills.getInstalledSkills(ws, home);
  const sharedEntry = installed.find(s => s.dirPath === sharedSkillDir);
  skills.removeSkill(sharedEntry, { workspaceRoot: ws, userHome: home });

  helper.check(
    "2q. removing the shared store directly also sweeps Claude's now-dangling dependent link",
    !fs.existsSync(sharedSkillDir) && !skills.isLinkPath(claudeSkillDir) && !fs.existsSync(claudeSkillDir),
    `shared exists=${fs.existsSync(sharedSkillDir)} claude isLink=${skills.isLinkPath(claudeSkillDir)} claude exists=${fs.existsSync(claudeSkillDir)}`
  );
}

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(ws, { recursive: true, force: true });

helper.finish();
