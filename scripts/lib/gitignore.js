const fs = require('fs');
const path = require('path');

function ensureWorkspaceGitignorePatterns(wsRoot, patterns) {
  const gitignorePath = path.join(wsRoot, '.gitignore');
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }

    const lines = content.split(/\r?\n/);
    const addedPatterns = [];

    for (const pattern of patterns) {
      const isIgnored = lines.some(line => {
        const trimmed = line.trim();
        return trimmed === pattern ||
               trimmed === pattern.slice(0, -1) ||
               (pattern === '.claude/harness-state/' && (trimmed === '.claude/' || trimmed === '.claude'));
      });

      if (!isIgnored) {
        addedPatterns.push(pattern);
      }
    }

    if (addedPatterns.length > 0) {
      const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
      const toAppend = addedPatterns.join('\n') + '\n';
      fs.appendFileSync(gitignorePath, `${separator}${toAppend}`, 'utf8');
      console.log(`  ✅ Added auto-generated directories to .gitignore: ${addedPatterns.join(', ')}`);
    }
  } catch (err) {
    console.warn(`  ⚠️ Failed to update .gitignore: ${err.message}`);
  }
}

// Only ever deletes a directory that is genuinely empty, and never recurses
// past one of `stopDirs` (workspace root / user home / filesystem root) - so
// this can only ever tidy up directories Harness itself just emptied out,
// never reach into a parent that still holds unrelated content.
function cleanEmptyDirs(dir, stopDirs) {
  if (!fs.existsSync(dir)) return;
  if ((stopDirs || []).includes(dir) || dir === path.parse(dir).root) return;
  try {
    const files = fs.readdirSync(dir);
    if (files.length === 0) {
      fs.rmdirSync(dir);
      console.log(`  ✅ Cleaned up empty directory: ${dir}`);
      cleanEmptyDirs(path.dirname(dir), stopDirs);
    }
  } catch (e) {
    // ignore
  }
}

module.exports = { ensureWorkspaceGitignorePatterns, cleanEmptyDirs };
