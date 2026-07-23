const path = require('path');
const fs = require('fs');

// Codex CLI's real project-scoped home is `.codex/` (it reads `.codex/skills/`
// for project skills and `.codex/config.toml` for CLI/sandbox config, walking
// up to the `.git` root exactly like AGENTS.md - see
// https://developers.openai.com/codex/config-advanced and
// https://www.agensi.io/learn/codex-cli-agents-md-complete-guide). Skills
// stay at that native `.codex/skills/` location; only bookkeeping that never
// had a home (runtime state, install manifest) converges into
// `.codex/harness-everything/`.
module.exports = {
  name: 'codex',
  label: 'Codex / Gemini',
  getHarnessDir(workspaceRoot) {
    return path.join(workspaceRoot, '.codex', 'harness-everything');
  },
  getStateDir(workspaceRoot) {
    return path.join(this.getHarnessDir(workspaceRoot), 'state');
  },
  getSkillsDir(workspaceRoot) {
    return path.join(workspaceRoot, '.codex', 'skills');
  },
  getIgnorePatterns(workspaceRoot) {
    const patterns = ['.codex/harness-everything/'];
    if (fs.existsSync(path.join(workspaceRoot, '.codex', 'skills'))) {
      patterns.push('.codex/skills/');
    }
    return patterns;
  },
  isMatch(pattern, trimmedLine) {
    if (pattern === '.codex/harness-everything/') {
      return trimmedLine === '.codex/' ||
             trimmedLine === '.codex' ||
             trimmedLine === '.codex/harness-everything' ||
             trimmedLine === '.codex/harness-everything/';
    }
    return trimmedLine === pattern || trimmedLine === pattern.slice(0, -1);
  },
  isInstalled(workspaceRoot, userHome, isGlobal) {
    if (isGlobal) {
      return false;
    }
    return fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
  }
};
