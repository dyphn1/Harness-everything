// Tracks exactly what this package installed, so uninstall can remove
// precisely those paths instead of sweeping shared directories that may also
// hold content from other tools, the user's own manual additions, or
// self-evolve's locally-generated skills.
//
// The manifest always lives at <platform-home>/harness-everything/manifest.json
// - e.g. .claude/harness-everything/manifest.json, .cursor/harness-everything/
// manifest.json, or (global scope) ~/.agents/harness-everything/manifest.json.
// harness-everything/ is a subfolder this package exclusively owns inside a
// directory that already belongs to that platform (or, for global scope, the
// shared ~/.agents convention) - nothing else creates a directory literally
// named "harness-everything" there, so nesting under it is what makes "the
// manifest can only describe our own installs" actually true.
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'harness-everything';
const HARNESS_AUTHOR = 'Miya Daniel | Harness Core Team';
const HARNESS_DIR_NAME = 'harness-everything';

function getHarnessDir(homeDir) {
  return path.join(homeDir, HARNESS_DIR_NAME);
}

function getManifestPath(homeDir) {
  return path.join(getHarnessDir(homeDir), 'manifest.json');
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return { package: PACKAGE_NAME, skills: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(data.skills)) data.skills = [];
    return data;
  } catch (e) {
    return { package: PACKAGE_NAME, skills: [] };
  }
}

function writeManifest(manifestPath, data) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf8');
}

function recordSkillInstall(manifestPath, packageVersion, skillId, dirPath) {
  const data = readManifest(manifestPath);
  data.package = PACKAGE_NAME;
  data.version = packageVersion;
  data.updatedAt = new Date().toISOString();
  const idx = data.skills.findIndex(s => s.dirPath === dirPath);
  const entry = { id: skillId, dirPath, installedAt: new Date().toISOString() };
  if (idx !== -1) data.skills[idx] = entry;
  else data.skills.push(entry);
  writeManifest(manifestPath, data);
}

// Removes one skill entry, and - once no skills remain in it - deletes the
// manifest file itself rather than leaving an empty bookkeeping file behind.
function removeSkillFromManifest(manifestPath, dirPath) {
  if (!fs.existsSync(manifestPath)) return;
  const data = readManifest(manifestPath);
  data.skills = data.skills.filter(s => s.dirPath !== dirPath);
  if (data.skills.length === 0) {
    fs.unlinkSync(manifestPath);
  } else {
    writeManifest(manifestPath, data);
  }
}

module.exports = {
  PACKAGE_NAME,
  HARNESS_AUTHOR,
  HARNESS_DIR_NAME,
  getHarnessDir,
  getManifestPath,
  readManifest,
  writeManifest,
  recordSkillInstall,
  removeSkillFromManifest,
};
