const fs = require('fs');
const path = require('path');

/**
 * Checks if a target pattern is already covered by a line in .gitignore.
 * Handles exact matches, trailing slash differences, and parent directory subsumption
 * (e.g. `.claude/` or `.claude` subsumes `.claude/harness-everything/state/`).
 */
function isPatternCoveredByLine(pattern, gitignoreLine) {
  const normPattern = pattern.trim().replace(/\\/g, '/');
  const normLine = gitignoreLine.trim().replace(/\\/g, '/');

  if (!normLine || normLine.startsWith('#') || normLine.startsWith('!')) {
    return false;
  }

  const cleanLine = normLine.endsWith('/') ? normLine.slice(0, -1) : normLine;
  const cleanPattern = normPattern.endsWith('/') ? normPattern.slice(0, -1) : normPattern;

  // Exact match or slash variant (e.g. '.claude' vs '.claude/')
  if (cleanLine === cleanPattern) {
    return true;
  }

  // Parent directory check: e.g. '.claude' covers '.claude/harness-everything/'
  if (cleanPattern.startsWith(cleanLine + '/')) {
    return true;
  }

  return false;
}

function ensureWorkspaceGitignorePatterns(wsRoot, patterns) {
  const gitignorePath = path.join(wsRoot, '.gitignore');
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }

    const lines = content.split(/\r?\n/);

    // Filter and prune lines:
    // 1. Remove exact duplicates.
    // 2. Remove subpaths that are already covered by an earlier parent rule in the file.
    const seenLines = [];
    let modified = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        seenLines.push(line);
        continue;
      }

      // Check if line is exact duplicate or covered by an earlier parent directory rule
      const isRedundant = seenLines.some(prevLine => isPatternCoveredByLine(trimmed, prevLine));
      if (isRedundant) {
        modified = true;
      } else {
        seenLines.push(line);
      }
    }

    // Determine which new patterns need to be added
    const addedPatterns = [];
    for (const pattern of patterns) {
      if (!pattern) continue;
      const isAlreadyCovered = seenLines.some(line => isPatternCoveredByLine(pattern, line));
      if (!isAlreadyCovered && !addedPatterns.some(p => isPatternCoveredByLine(pattern, p))) {
        addedPatterns.push(pattern);
      }
    }

    if (addedPatterns.length > 0 || modified) {
      const cleanedLines = [...seenLines];
      while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
        cleanedLines.pop();
      }

      const bannerComment = '# Harness OS Auto-generated Ignore Rules';
      const hasBanner = cleanedLines.some(line => line.trim() === bannerComment);
      const toAppend = [];
      if (!hasBanner && addedPatterns.length > 0) {
        toAppend.push('', bannerComment);
      }
      toAppend.push(...addedPatterns);

      const finalLines = cleanedLines.concat(toAppend);
      fs.writeFileSync(gitignorePath, finalLines.join('\n') + '\n', 'utf8');
      if (addedPatterns.length > 0) {
        console.log(`  ✅ Added auto-generated directories to .gitignore: ${addedPatterns.join(', ')}`);
      }
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
