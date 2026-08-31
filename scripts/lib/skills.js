// Skill discovery, copy, and manifest-aware install/uninstall bookkeeping.
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getAvailableSkills(harnessSourceDir) {
  const dirs = fs.readdirSync(harnessSourceDir, { withFileTypes: true });
  const skills = [];
  for (const dir of dirs) {
    if (dir.isDirectory() && !dir.name.startsWith('.') && !['bin', 'docs', 'hooks', 'scripts', 'node_modules'].includes(dir.name)) {
      const skillPath = path.join(harnessSourceDir, dir.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        skills.push(dir.name);
      }
    }
  }
  return skills.sort();
}

function parseFrontmatter(skillMdPath) {
  if (!fs.existsSync(skillMdPath)) return null;
  try {
    const content = fs.readFileSync(skillMdPath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    const yaml = match[1];
    const get = (key) => {
      const m = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
      return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
    };
    // Spec-compliant skills carry author/version under `metadata:`; older
    // installs (pre-0.3.4 copies already sitting in user workspaces) keep
    // them at the top level, so read both and prefer the nested form.
    const getMeta = (key) => {
      // Only keys nested under `metadata:` are indented in frontmatter,
      // so matching the indented key directly is unambiguous.
      const m = yaml.match(new RegExp(`^[ \\t]+${key}:\\s*(.*)$`, 'm'));
      return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
    };
    return {
      name: get('name'),
      description: get('description'),
      author: getMeta('author') || get('author'),
      version: getMeta('version') || get('version'),
    };
  } catch (e) {
    return null;
  }
}

function getSkillInfo(harnessSourceDir, skillDirName) {
  const fm = parseFrontmatter(path.join(harnessSourceDir, skillDirName, 'SKILL.md'));
  if (!fm) return null;
  return { id: skillDirName, name: fm.name || skillDirName, description: fm.description || '' };
}

// The one signal that lets uninstall tell "a skill this package shipped"
// apart from anything else living in the same shared skills folder (Cursor/
// Copilot/Codex/Continue skills keep their platform-native location, so it's
// still a shared folder) - including a user's own manually-installed skills
// and self-evolve's locally-generated `skills/generated/*` skills, neither
// of which carry this author string.
function isHarnessSkillDir(dirPath) {
  const fm = parseFrontmatter(path.join(dirPath, 'SKILL.md'));
  return !!fm && fm.author === manifest.HARNESS_AUTHOR;
}

// targetDirs entries: { path, label, manifestPath } - manifestPath is that
// target's own <platform-home>/harness-everything/manifest.json.
function installSkillsToTargets({ chosenSkills, targetDirs, harnessSourceDir, packageVersion }) {
  for (const target of targetDirs) {
    fs.mkdirSync(target.path, { recursive: true });
    
    // Copy references directory
    const refSrc = path.join(harnessSourceDir, 'references');
    if (fs.existsSync(refSrc)) {
      const refDest = path.join(path.dirname(target.manifestPath), 'references');
      if (fs.existsSync(refDest)) fs.rmSync(refDest, { recursive: true, force: true });
      copyDir(refSrc, refDest);
    }

    for (const skillName of chosenSkills) {
      const src = path.join(harnessSourceDir, skillName);
      const dest = path.join(target.path, skillName);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDir(src, dest);
      manifest.recordSkillInstall(target.manifestPath, packageVersion, skillName, dest);
      console.log(`  ✅ Installed skill: ${target.label}${skillName}/`);
    }
  }
}

function installAgentsToTarget({ target, harnessSourceDir, packageVersion }) {
  const sourceDir = path.join(harnessSourceDir, 'fable-mode', 'agents');
  if (!fs.existsSync(sourceDir) || !target || !target.path || !target.manifestPath) return;

  fs.mkdirSync(target.path, { recursive: true });
  const trackedPaths = new Set(
    (manifest.readManifest(target.manifestPath).agents || []).map(agent => agent.filePath)
  );
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(target.path, entry.name);
    if (fs.existsSync(destPath)) {
      const source = fs.readFileSync(sourcePath, 'utf8');
      const existing = fs.readFileSync(destPath, 'utf8');
      if (source !== existing) {
        console.warn(`  ⚠️ Preserved existing agent without overwrite: ${destPath}`);
        continue;
      }
      if (!trackedPaths.has(destPath)) {
        console.warn(`  ⚠️ Preserved pre-existing identical agent without claiming ownership: ${destPath}`);
        continue;
      }
    } else {
      fs.copyFileSync(sourcePath, destPath);
      console.log(`  ✅ Installed agent: ${target.label}${entry.name}`);
    }
    const agentInfo = parseFrontmatter(sourcePath);
    const agentName = (agentInfo && agentInfo.name) || entry.name.replace(/\.md$/i, '');
    manifest.recordAgentInstall(target.manifestPath, packageVersion, agentName, destPath);
  }
}

function manifestTrackedSkills(manifestPath, scopeLabel) {
  const data = manifest.readManifest(manifestPath);
  const results = [];
  for (const entry of data.skills || []) {
    if (fs.existsSync(entry.dirPath) && isHarnessSkillDir(entry.dirPath)) {
      results.push({ id: entry.id, scope: scopeLabel, dirPath: entry.dirPath, parentPath: path.dirname(entry.dirPath), manifestPath });
    }
  }
  return results;
}

// Returns every skill this package can currently account for, scoped local +
// global. Never lists a directory just because it happens to live under a
// known skills folder - only manifest-recorded installs (or, as a fallback
// for pre-manifest / pre-reorg installs, directories that still self-identify
// via the author marker) qualify. This is what keeps "uninstall skills" from
// ever touching a skill this package didn't put there.
function getInstalledSkills(workspaceRoot, userHome) {
  const results = [];
  const globalAgentsDir = path.join(userHome, '.agents');

  const manifestHomes = [
    { home: path.join(workspaceRoot, '.claude'), scope: 'local (Claude)' },
    { home: path.join(workspaceRoot, '.cursor'), scope: 'local (Cursor)' },
    { home: path.join(workspaceRoot, '.github'), scope: 'local (Copilot)' },
    { home: path.join(workspaceRoot, '.codex'), scope: 'local (Codex)' },
    { home: path.join(workspaceRoot, '.continue'), scope: 'local (Continue)' },
    { home: path.join(userHome, '.claude'), scope: 'global (Claude)' },
    { home: globalAgentsDir, scope: 'global' },
  ];
  for (const { home, scope } of manifestHomes) {
    results.push(...manifestTrackedSkills(manifest.getManifestPath(home), scope));
  }

  // Legacy fallback for installs that predate per-platform manifests (or the
  // old self-invented .harness/ local root, or - for Codex specifically - an
  // earlier version's mistaken `.agents/skills` target; Codex's real project
  // skills directory is `.codex/skills/`): scan the raw directories
  // directly, but only ever list an entry that still self-identifies via the
  // author marker - never a blind directory listing.
  const legacyDirs = [
    { path: path.join(workspaceRoot, '.harness', 'skills'), scope: 'local (legacy .harness)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.claude')) },
    { path: path.join(workspaceRoot, '.claude', 'harness-everything', 'skills'), scope: 'local (Claude legacy erroneous path)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.claude')) },
    { path: path.join(workspaceRoot, '.cursor', 'skills'), scope: 'local (Cursor)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.cursor')) },
    { path: path.join(workspaceRoot, '.github', 'skills'), scope: 'local (Copilot)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.github')) },
    { path: path.join(workspaceRoot, '.codex', 'skills'), scope: 'local (Codex)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.codex')) },
    { path: path.join(workspaceRoot, '.agents', 'skills'), scope: 'local (Codex, legacy .agents path)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.codex')) },
    { path: path.join(workspaceRoot, '.continue', 'skills'), scope: 'local (Continue)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.continue')) },
    { path: path.join(globalAgentsDir, 'skills'), scope: 'global', manifestPath: manifest.getManifestPath(globalAgentsDir) },
  ];
  const known = new Set(results.map(r => r.dirPath));
  for (const item of legacyDirs) {
    if (!fs.existsSync(item.path)) continue;
    try {
      const entries = fs.readdirSync(item.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(item.path, entry.name);
        if (known.has(dirPath)) continue;
        if (isHarnessSkillDir(dirPath)) {
          results.push({ id: entry.name, scope: item.scope, dirPath, parentPath: item.path, manifestPath: item.manifestPath });
          known.add(dirPath);
        }
      }
    } catch (e) {
      // ignore unreadable dirs
    }
  }
  return results;
}

function getInstalledAgents(workspaceRoot, userHome) {
  const homes = [
    { home: path.join(workspaceRoot, '.claude'), scope: 'local (Claude)' },
    { home: path.join(userHome, '.claude'), scope: 'global (Claude)' },
  ];
  const results = [];
  for (const { home, scope } of homes) {
    const manifestPath = manifest.getManifestPath(home);
    const data = manifest.readManifest(manifestPath);
    for (const entry of data.agents || []) {
      if (entry.filePath && fs.existsSync(entry.filePath)) {
        results.push({ ...entry, scope, manifestPath });
      }
    }
  }
  return results;
}

function removeSkill(entry) {
  if (fs.existsSync(entry.dirPath)) {
    fs.rmSync(entry.dirPath, { recursive: true, force: true });
  }
  if (entry.manifestPath) {
    manifest.removeSkillFromManifest(entry.manifestPath, entry.dirPath);
  }
}

function removeAgent(entry) {
  if (entry.filePath && fs.existsSync(entry.filePath)) {
    fs.unlinkSync(entry.filePath);
  }
  if (entry.manifestPath) {
    manifest.removeAgentFromManifest(entry.manifestPath, entry.filePath);
  }
}

module.exports = {
  copyDir,
  getAvailableSkills,
  getSkillInfo,
  isHarnessSkillDir,
  installSkillsToTargets,
  installAgentsToTarget,
  getInstalledSkills,
  getInstalledAgents,
  removeSkill,
  removeAgent,
};
