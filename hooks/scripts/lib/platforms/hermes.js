const path = require('path');
const fs = require('fs');

const GLOBAL_MARKER = 'hermes-global.json';

function appendHarnessSkillPatterns(patterns, skillsDir, prefix) {
  if (!fs.existsSync(skillsDir)) return;
  try {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;
      const content = fs.readFileSync(skillMdPath, 'utf8');
      const authorLine = content.split('\n').find(line => line.trim().startsWith('author:'));
      if (authorLine && authorLine.includes('Miya Daniel')) patterns.push(`${prefix}/${entry.name}/`);
    }
  } catch (e) {
    // Best effort only; ignore-pattern generation must not break installation.
  }
}

module.exports = {
  name: 'hermes',
  label: 'Hermes Agent',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.hermes', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(workspaceRoot, '.hermes', 'harness-state');
  },
  getSkillsDir(workspaceRoot) {
    // Hermes discovers trusted project skills from `.agents/skills/` as well
    // as `.hermes/skills/`. Use the shared Agent Skills location locally so
    // explicit `--copy` and canonical auto mode are both discoverable.
    return path.join(workspaceRoot, '.agents', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = [];
    if (fs.existsSync(path.join(workspaceRoot, '.hermes', 'harness-state'))) patterns.push('.hermes/harness-state/');
    if (fs.existsSync(path.join(workspaceRoot, '.hermes', 'harness-everything'))) patterns.push('.hermes/harness-everything/');
    appendHarnessSkillPatterns(patterns, path.join(workspaceRoot, '.agents', 'skills'), '.agents/skills');
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.hermes/harness-state/' || pattern === '.hermes/harness-everything/') {
      return trimmedLine === '.hermes/' ||
             trimmedLine === '.hermes' ||
             trimmedLine === pattern.slice(0, -1) ||
             trimmedLine === pattern;
    }
    if ((trimmedLine === '.agents/' || trimmedLine === '.agents') && pattern.startsWith('.agents/skills/')) return true;
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return fs.existsSync(path.join(userHome, '.hermes', 'skills')) ||
        fs.existsSync(path.join(userHome, '.agents', 'harness-everything', GLOBAL_MARKER));
    }
    return fs.existsSync(path.join(workspaceRoot, '.hermes.md'));
  },
  getSkillsTarget({ workspaceRoot, userHome, isGlobal, manifest }) {
    if (isGlobal) {
      const hermesDir = path.join(userHome, '.hermes');
      return {
        path: path.join(hermesDir, 'skills'),
        label: '~/.hermes/skills/',
        manifestPath: manifest.getManifestPath(hermesDir),
      };
    }
    const hermesDir = path.join(workspaceRoot, '.hermes');
    return {
      path: path.join(workspaceRoot, '.agents', 'skills'),
      label: '.agents/skills/',
      manifestPath: manifest.getManifestPath(hermesDir),
    };
  },
  install({ isGlobal, targetWorkspaceRoot, advisory, userHome }) {
    if (!isGlobal) {
      const targetFile = path.join(targetWorkspaceRoot, '.hermes.md');
      advisory.injectAdvisoryText(targetFile, '# .hermes.md', '.hermes.md');
    } else {
      // Hermes has no global advisory-context file. Keep a tiny Harness-owned
      // marker in the existing global bookkeeping home so non-interactive
      // uninstall can distinguish an intentional Hermes global install from
      // an unrelated ~/.hermes directory without changing Hermes config.
      const markerDir = path.join(userHome, '.agents', 'harness-everything');
      fs.mkdirSync(markerDir, { recursive: true });
      fs.writeFileSync(
        path.join(markerDir, GLOBAL_MARKER),
        JSON.stringify({ package: 'harness-everything', platform: 'hermes' }, null, 2),
        'utf8'
      );
      console.log('  ℹ️  Hermes global skills install to ~/.hermes/skills/. Project advisory context remains project-scoped via .hermes.md.');
    }
  },
  uninstall({ removeLocal, removeGlobal, workspaceRoot, userHome, cleanEmptyDirs }) {
    const advisory = require('../../../../scripts/lib/advisory-text');
    if (removeLocal) advisory.removeAdvisoryText(path.join(workspaceRoot, '.hermes.md'));
    if (removeGlobal) {
      const marker = path.join(userHome, '.agents', 'harness-everything', GLOBAL_MARKER);
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      if (typeof cleanEmptyDirs === 'function') {
        cleanEmptyDirs(path.join(userHome, '.hermes', 'skills'), [userHome]);
        cleanEmptyDirs(path.dirname(marker), [userHome]);
      }
    }
  }
};