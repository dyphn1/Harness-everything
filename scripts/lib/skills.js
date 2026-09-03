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

// lstat-based (never follows the link itself) so this is the one place that
// answers "is this path a symlink/junction" from the filesystem directly,
// independent of whatever a manifest happens to say about it - the fallback
// signal uninstall needs to stay correct even for hand-edited or pre-this-
// feature manifest rows that never recorded a `kind`.
function isLinkPath(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch (e) {
    return false;
  }
}

// A path "exists" for our purposes if it's a real file/dir OR a symlink/
// junction - fs.existsSync alone returns false for a link whose target has
// gone missing, which would otherwise hide a dangling link from cleanup.
function pathPresent(p) {
  return isLinkPath(p) || fs.existsSync(p);
}

function removePathSafely(p) {
  if (pathPresent(p)) {
    // Node's fs.rmSync never dereferences a symlink/junction to recurse into
    // its target - recursive:true only walks a REAL directory tree, so this
    // is safe for a link (removes just the link) and a physical copy alike.
    fs.rmSync(p, { recursive: true, force: true });
  }
}

// Local canonical store: <workspaceRoot>/.agents/skills/ - new with this
// feature, not previously used by any platform target.
// Global canonical store: ~/.agents/skills/ - already the literal
// getSkillsTarget() path every non-Claude platform (cursor/codex/continue/
// copilot/hermes) returns for global scope, so this reuses that existing
// shared directory rather than introducing a second one.
function getCanonicalSkillsDir({ isGlobal, workspaceRoot, userHome }) {
  return path.join(isGlobal ? userHome : workspaceRoot, '.agents', 'skills');
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

// Creates (or refreshes) the one physical copy of `skillName` that every
// target in this scope links into. Always a plain copyDir - the canonical
// copy itself is never a link.
function ensureCanonicalSkill({ canonicalDir, skillName, harnessSourceDir }) {
  const dest = path.join(canonicalDir, skillName);
  removePathSafely(dest);
  copyDir(path.join(harnessSourceDir, skillName), dest);
  return dest;
}

// Points `dest` at `canonicalSkillDir`: a junction on Windows (no elevated
// privileges needed for same-machine paths), a real symlink elsewhere.
// linkMode 'auto' silently falls back to a physical copy if link creation
// fails (e.g. cross-volume, locked-down environment); linkMode 'symlink'
// surfaces the failure instead, since the user explicitly asked for a link.
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
    if (linkMode === 'symlink') {
      throw new Error(`Failed to create symlink at ${dest}: ${e.message}`);
    }
    copyDir(path.join(harnessSourceDir, skillName), dest);
    return { kind: 'copy' };
  }
}

// targetDirs entries: { path, label, manifestPath } - manifestPath is that
// target's own <platform-home>/harness-everything/manifest.json.
//
// canonicalDir + linkMode ('auto' | 'symlink' | 'copy') opt into the shared-
// store model: one physical copy per scope under getCanonicalSkillsDir(),
// every target links into it - EXCEPT a target whose own path already IS the
// canonical dir (global scope: cursor/codex/continue/copilot/hermes already
// all resolve to ~/.agents/skills/ today), which just gets the physical copy
// directly and needs no link. Omitting canonicalDir (or passing linkMode
// 'copy') reproduces the pre-#49 behavior: an independent physical copy per
// target, no canonical store involved at all.
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

    // Copy references directory
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
        // This target's own directory IS the canonical store - the copy
        // ensureCanonicalSkill() just wrote already lives at `dest`.
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
    const linked = isLinkPath(entry.dirPath);
    // A recorded link is ours to clean up even if its canonical target has
    // gone missing (dangling link) - only a physical copy needs the
    // existsSync + author-marker check as defense in depth.
    if (!linked) {
      if (!fs.existsSync(entry.dirPath) || !isHarnessSkillDir(entry.dirPath)) continue;
    }
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

// Returns every skill this package can currently account for, scoped local +
// global. Never lists a directory just because it happens to live under a
// known skills folder - only manifest-recorded installs (or, as a fallback
// for pre-manifest / pre-reorg installs, directories that still self-identify
// via the author marker) qualify. This is what keeps "uninstall skills" from
// ever touching a skill this package didn't put there.
// opts.includeLegacy (default true) - false skips the raw-directory legacy
// scan below and returns only proper manifest-tracked entries. Used
// internally by removeSkill()'s canonical-store refcount check: a legacy-
// scanned entry never carries a real canonicalPath (that field only comes
// from a manifest record), so it can never legitimately represent "still in
// use" for that check - the one case it WOULD wrongly match is rediscovering
// the very canonical directory being evaluated the instant its last real
// manifest reference is removed (self-referential false positive), so that
// check asks for manifest-only results instead of filtering them out after
// the fact.
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
    { home: path.join(userHome, '.claude'), scope: 'global (Claude)' },
    { home: globalAgentsDir, scope: 'global' },
  ];
  for (const { home, scope } of manifestHomes) {
    results.push(...manifestTrackedSkills(manifest.getManifestPath(home), scope));
  }

  if (!includeLegacy) return results;

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
  // Also exclude every canonical store path referenced by a manifest-tracked
  // link (scripts/installer.js #49): the local/global canonical dir this
  // feature introduces at `.agents/skills/` is a physical directory that
  // legitimately backs one or more links elsewhere, and it happens to sit at
  // the exact path the pre-#49 legacy scan already watches (Codex's old
  // mistaken local target, and the pre-existing shared global store) - so
  // without this, a live canonical copy would get double-listed here as a
  // second, mislabeled "skill".
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

// ctx: { workspaceRoot, userHome } - optional, but without it the
// canonical-store refcount cleanup below is skipped (the removal of `entry`
// itself is always safe and always happens regardless).
//
// Detects link-vs-copy from the filesystem (isLinkPath), not from
// entry.kind/manifest bookkeeping - this is the fallback uninstall path: it
// stays correct even for a manifest row written before this feature existed,
// or one that's drifted from what's actually on disk.
function removeSkill(entry, ctx = {}) {
  const wasLink = isLinkPath(entry.dirPath);
  removePathSafely(entry.dirPath);
  if (entry.manifestPath) {
    manifest.removeSkillFromManifest(entry.manifestPath, entry.dirPath);
  }

  if (!ctx.workspaceRoot || !ctx.userHome) return;

  if (wasLink && entry.canonicalPath) {
    // Removed a link - if nothing else still points at (or IS) its canonical
    // copy, that copy is now orphaned. Clean it up too. Manifest-only
    // (includeLegacy: false): a legacy-scanned entry never carries a real
    // canonicalPath, and the moment this was the last real reference, the
    // legacy scan would otherwise rediscover the about-to-be-orphaned
    // canonical dir itself and falsely count it as still in use.
    const stillInUse = getInstalledSkills(ctx.workspaceRoot, ctx.userHome, { includeLegacy: false }).some(
      s => s.dirPath === entry.canonicalPath || s.canonicalPath === entry.canonicalPath
    );
    if (!stillInUse) removePathSafely(entry.canonicalPath);
  } else if (!wasLink) {
    // Removed a physical copy - anything still linking INTO it (recorded via
    // canonicalPath) is now dangling. Sweep those too rather than leaving
    // orphaned links + stale manifest rows behind. A no-op for an ordinary
    // physical copy that nothing ever linked to.
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
