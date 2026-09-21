const fs = require('fs');
const path = require('path');

/**
 * Checks if a target pattern is already covered by a line in an ignore file.
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

/**
 * Resolves the real git directory for a workspace. `.git` is usually a
 * directory, but in submodules and worktrees it is a FILE containing
 * `gitdir: <path>` - resolve that pointer so info/exclude lands in the right
 * place. Returns null when the workspace has no git repository.
 */
function resolveGitDir(wsRoot) {
  const dotGit = path.join(wsRoot, '.git');
  if (!fs.existsSync(dotGit)) return null;
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const content = fs.readFileSync(dotGit, 'utf8');
    const m = content.match(/gitdir:\s*(.+)/);
    if (!m) return null;
    let gitdir = m[1].trim();
    if (!path.isAbsolute(gitdir)) gitdir = path.resolve(wsRoot, gitdir);
    return fs.existsSync(gitdir) ? gitdir : null;
  } catch (e) {
    return null;
  }
}

const EXCLUDE_BANNER_BEGIN = '# --- Harness OS state (auto-managed; local only) ---';
const EXCLUDE_BANNER_END = '# --- end Harness OS state ---';
// Legacy marker written by older installers straight into .gitignore.
const LEGACY_GITIGNORE_BANNER = '# Harness OS Auto-generated Ignore Rules';

function readExcludeLines(gitDir) {
  try {
    return fs.readFileSync(path.join(gitDir, 'info', 'exclude'), 'utf8').split(/\r?\n/);
  } catch (e) {
    return null; // no exclude file yet - treat as empty but writable
  }
}

function writeExcludeSection(gitDir, patterns) {
  const infoDir = path.join(gitDir, 'info');
  fs.mkdirSync(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, 'exclude');
  let lines = [];
  try {
    lines = fs.readFileSync(excludePath, 'utf8').split(/\r?\n/);
  } catch (e) {}

  // Drop our previous section (if any), then rebuild it from the requested
  // patterns - so removals from getIgnorePatterns() propagate on reinstall.
  const beginIdx = lines.indexOf(EXCLUDE_BANNER_BEGIN);
  const endIdx = lines.indexOf(EXCLUDE_BANNER_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    lines.splice(beginIdx, endIdx - beginIdx + 1);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const section = ['', EXCLUDE_BANNER_BEGIN, ...patterns, EXCLUDE_BANNER_END, ''];
  fs.writeFileSync(excludePath, lines.concat(section).join('\n'), 'utf8');
}

/**
 * Idempotently records Harness state directories as LOCAL-ONLY ignores.
 *
 * Patterns go to `<gitdir>/info/exclude`, never the working tree's
 * .gitignore - installing or self-healing must not produce a diff in the
 * user's project. Also migrates away the legacy banner block that old
 * versions appended to .gitignore.
 */
function ensureWorkspaceGitignorePatterns(wsRoot, patterns) {
  const wanted = (patterns || []).filter(Boolean);

  // Migration: strip the legacy banner + its pattern lines from .gitignore.
  const gitignorePath = path.join(wsRoot, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (content.includes(LEGACY_GITIGNORE_BANNER)) {
        const lines = content.split(/\r?\n/);
        const start = lines.findIndex(l => l.trim() === LEGACY_GITIGNORE_BANNER);
        let end = start;
        // The legacy block ran until the first non-pattern line (blank/comment/other rule).
        for (let i = start + 1; i < lines.length; i++) {
          const t = lines[i].trim();
          if (t === '' || t.startsWith('#')) break;
          end = i;
        }
        lines.splice(start, end - start + 1);
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
        fs.writeFileSync(gitignorePath, lines.join('\n') + '\n', 'utf8');
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Failed to migrate legacy .gitignore entries: ${err.message}`);
  }

  const gitDir = resolveGitDir(wsRoot);
  if (!gitDir) {
    // No git repo -> nothing local-only to write into. State dirs are gated
    // elsewhere (bootstrap refuses unmanaged workspaces), so this is fine.
    return;
  }

  try {
    const existing = readExcludeLines(gitDir) || [];
    // Skip the write entirely when every wanted pattern is already inside our
    // managed section OR covered by any ignore line (user's own broader rule).
    const outside = existing.filter(
      l => l !== EXCLUDE_BANNER_BEGIN && l !== EXCLUDE_BANNER_END
    );
    const missing = wanted.filter(p => !outside.some(line => isPatternCoveredByLine(p, line)));
    const currentSection =
      beginEnd(existing).start === -1
        ? []
        : existing.slice(beginEnd(existing).start + 1, beginEnd(existing).end);
    const sameSet =
      currentSection.filter(l => l.trim() && !l.trim().startsWith('#')).join('\n') ===
      wanted.join('\n');
    if (missing.length === 0 && sameSet) return;

    writeExcludeSection(gitDir, wanted);
    console.log(`  ✅ Recorded local-only ignore rules in .git/info/exclude: ${wanted.join(', ')}`);
  } catch (err) {
    console.warn(`  ⚠️ Failed to update .git/info/exclude: ${err.message}`);
  }
}

function beginEnd(lines) {
  return { start: lines.indexOf(EXCLUDE_BANNER_BEGIN), end: lines.indexOf(EXCLUDE_BANNER_END) };
}

/**
 * Removes Harness's section from .git/info/exclude (uninstall cleanup).
 * Never touches user-authored exclude rules.
 */
function removeWorkspaceExcludePatterns(wsRoot) {
  const gitDir = resolveGitDir(wsRoot);
  if (!gitDir) return;
  try {
    const excludePath = path.join(gitDir, 'info', 'exclude');
    const lines = fs.readFileSync(excludePath, 'utf8').split(/\r?\n/);
    const { start, end } = beginEnd(lines);
    if (start === -1 || end === -1) return;
    lines.splice(start, end - start + 1);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    fs.writeFileSync(excludePath, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    // Best-effort
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

module.exports = { ensureWorkspaceGitignorePatterns, removeWorkspaceExcludePatterns, resolveGitDir, cleanEmptyDirs };
