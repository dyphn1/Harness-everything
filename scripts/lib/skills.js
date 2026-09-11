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
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function isLinkPath(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch (e) { return false; }
}

function pathPresent(p) {
  return isLinkPath(p) || fs.existsSync(p);
}

function removePathSafely(p) {
  if (pathPresent(p)) fs.rmSync(p, { recursive: true, force: true });
}

// `.agents/skills/` is the canonical per-scope store used for deduplication.
// Some hosts consume that path natively (for example Codex project skills),
// while others link from their own native directories (Continue/Hermes).
function getCanonicalSkillsDir({ isGlobal, workspaceRoot, userHome }) {
  return path.join(isGlobal ? userHome : workspaceRoot, '.agents', 'skills');
}

function getAvailableSkills(harnessSourceDir) {
  const dirs = fs.readdirSync(harnessSourceDir, { withFileTypes: true });
  const skills = [];
  for (const dir of dirs) {
    if (dir.isDirectory() && !dir.name.startsWith('.') && !['bin', 'docs', 'hooks', 'scripts', 'node_modules'].includes(dir.name)) {
      const skillPath = path.join(harnessSourceDir, dir.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) skills.push(dir.name);
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
    const getMeta = (key) => {
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

function isHarnessSkillDir(dirPath) {
  const fm = parseFrontmatter(path.join(dirPath, 'SKILL.md'));
  return !!fm && fm.author === manifest.HARNESS_AUTHOR;
}

function ensureCanonicalSkill({ canonicalDir, skillName, harnessSourceDir }) {
  const dest = path.join(canonicalDir, skillName);
  removePathSafely(dest);
  copyDir(path.join(harnessSourceDir, skillName), dest);
  return dest;
}

function linkOrCopySkill({ dest, canonicalSkillDir, harnessSourceDir, skillName, linkMode }) {
  removePathSafely(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (linkMode === 'copy') {
    copyDir(path.join(harnessSourceDir, skillName), dest);
    return { kind: 'copy' };
  }

  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(canonicalSkillDir, dest, symlinkType);
    return { kind: symlinkType === 'junction' ? 'junction' : 'symlink', canonicalPath: canonicalSkillDir };
  } catch (e) {
    if (linkMode === 'symlink') throw new Error(`Failed to create symlink at ${dest}: ${e.message}`);
    copyDir(path.join(harnessSourceDir, skillName), dest);
    return { kind: 'copy' };
  }
}

function installSkillsToTargets({ chosenSkills, targetDirs, harnessSourceDir, packageVersion, canonicalDir, linkMode = 'auto' }) {
  const useCanonical = !!canonicalDir && linkMode !== 'copy';
  const canonicalSkillDirs = {};
  if (useCanonical) {
    for (const skillName of chosenSkills) {
      canonicalSkillDirs[skillName] = ensureCanonicalSkill({ canonicalDir, skillName, harnessSourceDir });
    }
  }

  for (const target of targetDirs) {
    fs.mkdirSync(target.path, { recursive: true });
    const refSrc = path.join(harnessSourceDir, 'references');
    if (fs.existsSync(refSrc)) {
      const refDest = path.join(path.dirname(target.manifestPath), 'references');
      if (fs.existsSync(refDest)) fs.rmSync(refDest, { recursive: true, force: true });
      copyDir(refSrc, refDest);
    }

    const targetIsCanonical = useCanonical && path.resolve(target.path) === path.resolve(canonicalDir);
    for (const skillName of chosenSkills) {
      const dest = path.join(target.path, skillName);
      let result;
      if (!useCanonical) {
        removePathSafely(dest);
        copyDir(path.join(harnessSourceDir, skillName), dest);
        result = { kind: 'copy' };
      } else if (targetIsCanonical) {
        result = { kind: 'copy' };
      } else {
        result = linkOrCopySkill({ dest, canonicalSkillDir: canonicalSkillDirs[skillName], harnessSourceDir, skillName, linkMode });
      }
      manifest.recordSkillInstall(target.manifestPath, packageVersion, skillName, dest, result);
      const suffix = result.kind === 'copy' ? '' : ` (${result.kind} -> ${path.relative(path.dirname(dest), result.canonicalPath)})`;
      console.log(`  ✅ Installed skill: ${target.label}${skillName}/${suffix}`);
    }
  }
}

function installAgentsToTarget({ target, harnessSourceDir, packageVersion }) {
  const sourceDir = path.join(harnessSourceDir, 'fable-mode', 'agents');
  if (!fs.existsSync(sourceDir) || !target || !target.path || !target.manifestPath) return;

  fs.mkdirSync(target.path, { recursive: true });
  const trackedPaths = new Set((manifest.readManifest(target.manifestPath).agents || []).map(agent => agent.filePath));
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
    const linked = isLinkPath(entry.dirPath);
    if (!linked && (!fs.existsSync(entry.dirPath) || !isHarnessSkillDir(entry.dirPath))) continue;
    results.push({
      id: entry.id,
      scope: scopeLabel,
      dirPath: entry.dirPath,
      parentPath: path.dirname(entry.dirPath),
      manifestPath,
      canonicalPath: entry.canonicalPath || null,
    });
  }
  return results;
}

function getInstalledSkills(workspaceRoot, userHome, opts = {}) {
  const includeLegacy = opts.includeLegacy !== false;
  const results = [];
  const globalAgentsDir = path.join(userHome, '.agents');

  const manifestHomes = [
    { home: path.join(workspaceRoot, '.claude'), scope: 'local (Claude)' },
    { home: path.join(workspaceRoot, '.cursor'), scope: 'local (Cursor)' },
    { home: path.join(workspaceRoot, '.github'), scope: 'local (Copilot)' },
    { home: path.join(workspaceRoot, '.codex'), scope: 'local (Codex)' },
    { home: path.join(workspaceRoot, '.continue'), scope: 'local (Continue)' },
    { home: path.join(workspaceRoot, '.hermes'), scope: 'local (Hermes)' },
    { home: path.join(userHome, '.claude'), scope: 'global (Claude)' },
    { home: globalAgentsDir, scope: 'global (shared Agent Skills)' },
    { home: path.join(userHome, '.continue'), scope: 'global (Continue)' },
    { home: path.join(userHome, '.hermes'), scope: 'global (Hermes)' },
  ];
  for (const { home, scope } of manifestHomes) {
    results.push(...manifestTrackedSkills(manifest.getManifestPath(home), scope));
  }

  if (!includeLegacy) return results;

  const legacyDirs = [
    { path: path.join(workspaceRoot, '.harness', 'skills'), scope: 'local (legacy .harness)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.claude')) },
    { path: path.join(workspaceRoot, '.claude', 'harness-everything', 'skills'), scope: 'local (Claude legacy erroneous path)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.claude')) },
    { path: path.join(workspaceRoot, '.cursor', 'skills'), scope: 'local (Cursor)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.cursor')) },
    { path: path.join(workspaceRoot, '.github', 'skills'), scope: 'local (Copilot)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.github')) },
    { path: path.join(workspaceRoot, '.codex', 'skills'), scope: 'local (Codex legacy .codex path)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.codex')) },
    { path: path.join(workspaceRoot, '.agents', 'skills'), scope: 'local (shared Agent Skills)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.codex')) },
    { path: path.join(workspaceRoot, '.continue', 'skills'), scope: 'local (Continue)', manifestPath: manifest.getManifestPath(path.join(workspaceRoot, '.continue')) },
    { path: path.join(globalAgentsDir, 'skills'), scope: 'global (shared Agent Skills)', manifestPath: manifest.getManifestPath(globalAgentsDir) },
    { path: path.join(userHome, '.continue', 'skills'), scope: 'global (Continue)', manifestPath: manifest.getManifestPath(path.join(userHome, '.continue')) },
    { path: path.join(userHome, '.hermes', 'skills'), scope: 'global (Hermes)', manifestPath: manifest.getManifestPath(path.join(userHome, '.hermes')) },
  ];

  const known = new Set(results.flatMap(r => r.canonicalPath ? [r.dirPath, r.canonicalPath] : [r.dirPath]));
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
      // Ignore unreadable fallback directories.
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
      if (entry.filePath && fs.existsSync(entry.filePath)) results.push({ ...entry, scope, manifestPath });
    }
  }
  return results;
}

function removeSkill(entry, ctx = {}) {
  const wasLink = isLinkPath(entry.dirPath);
  removePathSafely(entry.dirPath);
  if (entry.manifestPath) manifest.removeSkillFromManifest(entry.manifestPath, entry.dirPath);

  if (!ctx.workspaceRoot || !ctx.userHome) return;

  if (wasLink && entry.canonicalPath) {
    const stillInUse = getInstalledSkills(ctx.workspaceRoot, ctx.userHome, { includeLegacy: false }).some(
      s => s.dirPath === entry.canonicalPath || s.canonicalPath === entry.canonicalPath
    );
    if (!stillInUse) removePathSafely(entry.canonicalPath);
  } else if (!wasLink) {
    const dependents = getInstalledSkills(ctx.workspaceRoot, ctx.userHome, { includeLegacy: false }).filter(
      s => s.canonicalPath === entry.dirPath
    );
    for (const dep of dependents) {
      removePathSafely(dep.dirPath);
      if (dep.manifestPath) manifest.removeSkillFromManifest(dep.manifestPath, dep.dirPath);
    }
  }
}

function removeAgent(entry) {
  if (entry.filePath && fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
  if (entry.manifestPath) manifest.removeAgentFromManifest(entry.manifestPath, entry.filePath);
}

module.exports = {
  copyDir,
  getAvailableSkills,
  getSkillInfo,
  isHarnessSkillDir,
  isLinkPath,
  pathPresent,
  getCanonicalSkillsDir,
  installSkillsToTargets,
  installAgentsToTarget,
  getInstalledSkills,
  getInstalledAgents,
  removeSkill,
  removeAgent,
};