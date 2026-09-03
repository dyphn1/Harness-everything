const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2p] Canonical-store link/copy install + link-aware uninstall (issue #49)...');

const skills = require('../scripts/lib/skills');
const manifest = require('../scripts/lib/manifest');

const harnessSourceDir = path.resolve(__dirname, '..');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2p-ws-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2p-home-'));

function target(name, dirName) {
  const home_ = path.join(ws, dirName);
  return { path: path.join(home_, 'skills'), label: `${dirName}/skills/`, manifestPath: manifest.getManifestPath(home_) };
}

// --- 1. Link mode: two targets sharing one canonical copy ---
const claudeTarget = target('claude', '.claude');
const cursorTarget = target('cursor', '.cursor');
const canonicalDir = skills.getCanonicalSkillsDir({ isGlobal: false, workspaceRoot: ws, userHome: home });

skills.installSkillsToTargets({
  chosenSkills: ['tdd'],
  targetDirs: [claudeTarget, cursorTarget],
  harnessSourceDir,
  packageVersion: '9.9.9',
  canonicalDir,
  linkMode: 'auto',
});

const claudeSkillDir = path.join(claudeTarget.path, 'tdd');
const cursorSkillDir = path.join(cursorTarget.path, 'tdd');
const canonicalSkillDir = path.join(canonicalDir, 'tdd');

helper.check(
  '2p. both platform targets are real links (symlink/junction), not physical copies',
  skills.isLinkPath(claudeSkillDir) && skills.isLinkPath(cursorSkillDir),
  `claude isLink=${skills.isLinkPath(claudeSkillDir)} cursor isLink=${skills.isLinkPath(cursorSkillDir)}`
);
helper.check(
  '2p. the canonical copy itself is a physical directory, not a link',
  fs.existsSync(canonicalSkillDir) && !skills.isLinkPath(canonicalSkillDir),
  `canonical exists=${fs.existsSync(canonicalSkillDir)} isLink=${skills.isLinkPath(canonicalSkillDir)}`
);
helper.check(
  '2p. content is readable through the link and matches source',
  fs.existsSync(path.join(claudeSkillDir, 'SKILL.md')) &&
    fs.readFileSync(path.join(claudeSkillDir, 'SKILL.md'), 'utf8') === fs.readFileSync(path.join(harnessSourceDir, 'tdd', 'SKILL.md'), 'utf8'),
  'linked SKILL.md content did not match source'
);

const claudeManifestEntry = manifest.readManifest(claudeTarget.manifestPath).skills[0];
helper.check(
  '2p. manifest records kind + canonicalPath for a linked entry',
  claudeManifestEntry && ['symlink', 'junction'].includes(claudeManifestEntry.kind) && claudeManifestEntry.canonicalPath === canonicalSkillDir,
  `Got: ${JSON.stringify(claudeManifestEntry)}`
);

// --- 2. getInstalledSkills surfaces both links, and the canonical dir is
// NOT double-listed as its own separate skill (advisor-flagged legacy-scan
// collision fix). ---
{
  const installed = skills.getInstalledSkills(ws, home);
  const tddEntries = installed.filter(s => s.id === 'tdd');
  helper.check(
    '2p. getInstalledSkills lists exactly the 2 linked entries, not the canonical dir as a 3rd',
    tddEntries.length === 2,
    `Got ${tddEntries.length}: ${JSON.stringify(tddEntries.map(e => e.dirPath))}`
  );
}

// --- 3. Removing one link leaves the canonical copy (still referenced by
// the other link) intact; removing the last link removes it too. ---
{
  const installedBefore = skills.getInstalledSkills(ws, home);
  const claudeEntry = installedBefore.find(s => s.dirPath === claudeSkillDir);
  skills.removeSkill(claudeEntry, { workspaceRoot: ws, userHome: home });

  helper.check(
    '2p. removing one link deletes only that link, canonical copy survives (still referenced)',
    !fs.existsSync(claudeSkillDir) && fs.existsSync(canonicalSkillDir),
    `claude exists=${fs.existsSync(claudeSkillDir)} canonical exists=${fs.existsSync(canonicalSkillDir)}`
  );

  const installedAfterFirst = skills.getInstalledSkills(ws, home);
  const cursorEntry = installedAfterFirst.find(s => s.dirPath === cursorSkillDir);
  skills.removeSkill(cursorEntry, { workspaceRoot: ws, userHome: home });

  helper.check(
    '2p. removing the LAST link also removes the now-orphaned canonical copy',
    !fs.existsSync(cursorSkillDir) && !fs.existsSync(canonicalSkillDir),
    `cursor exists=${fs.existsSync(cursorSkillDir)} canonical exists=${fs.existsSync(canonicalSkillDir)}`
  );
}

// --- 4. --copy mode produces independent physical copies, no canonical
// store, no links at all. ---
{
  const copyTarget = target('codex', '.codex');
  skills.installSkillsToTargets({
    chosenSkills: ['tdd'],
    targetDirs: [copyTarget],
    harnessSourceDir,
    packageVersion: '9.9.9',
    canonicalDir: skills.getCanonicalSkillsDir({ isGlobal: false, workspaceRoot: ws, userHome: home }),
    linkMode: 'copy',
  });
  const copySkillDir = path.join(copyTarget.path, 'tdd');
  helper.check(
    '2p. --copy mode installs a physical directory, not a link',
    fs.existsSync(copySkillDir) && !skills.isLinkPath(copySkillDir),
    `exists=${fs.existsSync(copySkillDir)} isLink=${skills.isLinkPath(copySkillDir)}`
  );
  const entry = manifest.readManifest(copyTarget.manifestPath).skills[0];
  helper.check(
    '2p. --copy mode manifest entry has no kind/canonicalPath',
    entry && !entry.kind && !entry.canonicalPath,
    `Got: ${JSON.stringify(entry)}`
  );
  const installedEntry = skills.getInstalledSkills(ws, home).find(s => s.dirPath === copySkillDir);
  skills.removeSkill(installedEntry, { workspaceRoot: ws, userHome: home });
  helper.check('2p. --copy mode entry uninstalls cleanly', !fs.existsSync(copySkillDir), 'copy-mode dir still exists after removeSkill');
}

// --- 5. Dangling link (canonical target manually deleted) is still
// detected and cleaned up rather than silently ignored. ---
{
  const danglingTarget = target('continue', '.continue');
  skills.installSkillsToTargets({
    chosenSkills: ['tdd'],
    targetDirs: [danglingTarget],
    harnessSourceDir,
    packageVersion: '9.9.9',
    canonicalDir: skills.getCanonicalSkillsDir({ isGlobal: false, workspaceRoot: ws, userHome: home }),
    linkMode: 'symlink',
  });
  const linkDir = path.join(danglingTarget.path, 'tdd');
  const canonicalTddDir = path.join(skills.getCanonicalSkillsDir({ isGlobal: false, workspaceRoot: ws, userHome: home }), 'tdd');
  fs.rmSync(canonicalTddDir, { recursive: true, force: true }); // simulate manual/out-of-band deletion

  helper.check(
    '2p. a dangling link is still detected as present (pathPresent) even though its target is gone',
    skills.pathPresent(linkDir) && !fs.existsSync(linkDir),
    `pathPresent=${skills.pathPresent(linkDir)} existsSync=${fs.existsSync(linkDir)}`
  );

  const installed = skills.getInstalledSkills(ws, home);
  const danglingEntry = installed.find(s => s.dirPath === linkDir);
  helper.check('2p. getInstalledSkills still surfaces the dangling link for cleanup', !!danglingEntry, 'dangling link entry missing from getInstalledSkills');
  if (danglingEntry) {
    skills.removeSkill(danglingEntry, { workspaceRoot: ws, userHome: home });
    helper.check(
      '2p. removeSkill cleans up the dangling link and its manifest row',
      !skills.isLinkPath(linkDir) && manifest.readManifest(danglingTarget.manifestPath).skills.length === 0,
      `isLink=${skills.isLinkPath(linkDir)} manifest=${JSON.stringify(manifest.readManifest(danglingTarget.manifestPath))}`
    );
  }
}

// --- 6. A legacy manifest entry with no canonicalPath (pre-#49 install)
// still uninstalls exactly as before - no forced migration required. ---
{
  const legacyTarget = target('copilot', '.github');
  fs.mkdirSync(legacyTarget.path, { recursive: true });
  const legacyDir = path.join(legacyTarget.path, 'tdd');
  skills.copyDir(path.join(harnessSourceDir, 'tdd'), legacyDir);
  manifest.recordSkillInstall(legacyTarget.manifestPath, '0.3.0', 'tdd', legacyDir); // no linkInfo - pre-#49 shape

  const entry = skills.getInstalledSkills(ws, home).find(s => s.dirPath === legacyDir);
  helper.check('2p. a pre-#49 manifest entry (no kind/canonicalPath) is still discovered', !!entry, 'legacy entry not found');
  if (entry) {
    skills.removeSkill(entry, { workspaceRoot: ws, userHome: home });
    helper.check('2p. a pre-#49 entry uninstalls cleanly with no canonical-store side effects', !fs.existsSync(legacyDir), 'legacy dir still exists');
  }
}

fs.rmSync(ws, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });

helper.finish();
