// Tracks exactly what this package installed, so uninstall can remove
// precisely those paths instead of sweeping shared directories that may also
// hold content from other tools, the user's own manual additions, or
// self-evolve's locally-generated skills.
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'harness-everything';
const HARNESS_AUTHOR = 'Miya Daniel';
const HARNESS_DIR_NAME = 'harness-everything';

function getHarnessDir(homeDir) {
  return path.join(homeDir, HARNESS_DIR_NAME);
}

function getManifestPath(homeDir) {
  return path.join(getHarnessDir(homeDir), 'manifest.json');
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { package: PACKAGE_NAME, skills: [], agents: [] };
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(data.skills)) data.skills = [];
    if (!Array.isArray(data.agents)) data.agents = [];
    return data;
  } catch (e) {
    return { package: PACKAGE_NAME, skills: [], agents: [] };
  }
}

function writeManifest(manifestPath, data) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf8');
}

function isManifestEmpty(data) {
  return (data.skills || []).length === 0 &&
    (data.generated || []).length === 0 &&
    (data.agents || []).length === 0;
}

// `references/` is copied by the installer into the same Harness-owned
// bookkeeping directory as manifest.json. Once the manifest contains no
// owned artifacts, both are package-owned leftovers and can be removed as a
// unit without touching the platform home around them.
function removeManifestArtifactsIfEmpty(manifestPath, data) {
  if (!isManifestEmpty(data)) return false;
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  const harnessDir = path.dirname(manifestPath);
  const referencesDir = path.join(harnessDir, 'references');
  if (fs.existsSync(referencesDir)) fs.rmSync(referencesDir, { recursive: true, force: true });
  try {
    if (fs.existsSync(harnessDir) && fs.readdirSync(harnessDir).length === 0) fs.rmdirSync(harnessDir);
  } catch (e) {
    // Another owned runtime artifact may still live here; leave it intact.
  }
  return true;
}

function recordSkillInstall(manifestPath, packageVersion, skillId, dirPath, linkInfo = {}) {
  const data = readManifest(manifestPath);
  data.package = PACKAGE_NAME;
  data.version = packageVersion;
  data.updatedAt = new Date().toISOString();
  const idx = data.skills.findIndex(s => s.dirPath === dirPath);
  const entry = { id: skillId, dirPath, installedAt: new Date().toISOString() };
  if (linkInfo.kind && linkInfo.kind !== 'copy') {
    entry.kind = linkInfo.kind;
    entry.canonicalPath = linkInfo.canonicalPath;
  }
  if (idx !== -1) data.skills[idx] = entry;
  else data.skills.push(entry);
  writeManifest(manifestPath, data);
}

function recordAgentInstall(manifestPath, packageVersion, agentId, filePath) {
  const data = readManifest(manifestPath);
  data.package = PACKAGE_NAME;
  data.version = packageVersion;
  data.updatedAt = new Date().toISOString();
  const idx = data.agents.findIndex(agent => agent.filePath === filePath);
  const entry = { id: agentId, filePath, installedAt: new Date().toISOString() };
  if (idx !== -1) data.agents[idx] = entry;
  else data.agents.push(entry);
  writeManifest(manifestPath, data);
}

function recordGeneratedSkill(manifestPath, skillId, dirPath, description, triggers = []) {
  const data = readManifest(manifestPath);
  if (!Array.isArray(data.generated)) data.generated = [];
  data.updatedAt = new Date().toISOString();
  const idx = data.generated.findIndex(s => s.dirPath === dirPath || s.id === skillId);
  const entry = {
    id: skillId,
    dirPath,
    description,
    triggers: Array.isArray(triggers) ? triggers : [],
    generatedAt: new Date().toISOString()
  };
  if (idx !== -1) data.generated[idx] = { ...data.generated[idx], ...entry };
  else data.generated.push(entry);
  writeManifest(manifestPath, data);
}

function removeGeneratedSkill(manifestPath, dirPath) {
  if (!fs.existsSync(manifestPath)) return;
  const data = readManifest(manifestPath);
  if (!Array.isArray(data.generated)) return;
  data.generated = data.generated.filter(s => s.dirPath !== dirPath);
  if (!removeManifestArtifactsIfEmpty(manifestPath, data)) writeManifest(manifestPath, data);
}

function removeSkillFromManifest(manifestPath, dirPath) {
  if (!fs.existsSync(manifestPath)) return;
  const data = readManifest(manifestPath);
  data.skills = data.skills.filter(s => s.dirPath !== dirPath);
  if (!removeManifestArtifactsIfEmpty(manifestPath, data)) writeManifest(manifestPath, data);
}

function removeAgentFromManifest(manifestPath, filePath) {
  if (!fs.existsSync(manifestPath)) return;
  const data = readManifest(manifestPath);
  data.agents = data.agents.filter(agent => agent.filePath !== filePath);
  if (!removeManifestArtifactsIfEmpty(manifestPath, data)) writeManifest(manifestPath, data);
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
  recordAgentInstall,
  recordGeneratedSkill,
  removeGeneratedSkill,
  removeSkillFromManifest,
  removeAgentFromManifest,
};