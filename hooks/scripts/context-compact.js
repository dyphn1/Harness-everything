#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  // Let's run a quick Git check to estimate context size from modified files
  const statusRaw = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!statusRaw) {
    process.exit(0);
  }

  const lines = statusRaw.split('\n').filter(Boolean);
  const modifiedCount = lines.length;

  let totalDiffLines = 0;
  try {
    const diffStat = execSync('git diff --numstat', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (diffStat) {
      diffStat.split('\n').forEach(line => {
        const [added, deleted] = line.split('\t');
        if (added && added !== '-' && deleted && deleted !== '-') {
          totalDiffLines += parseInt(added) + parseInt(deleted);
        }
      });
    }
  } catch (err) {
    // Ignore git errors
  }

  // Thresholds for warning
  const HIGH_FILE_LIMIT = 6;
  const HIGH_LINE_LIMIT = 400;

  if (modifiedCount >= HIGH_FILE_LIMIT || totalDiffLines >= HIGH_LINE_LIMIT) {
    // Plain stdout on exit 0 is only surfaced to Claude for UserPromptSubmit/
    // SessionStart - for PreToolUse it's written to a debug log Claude never
    // sees. To actually get an advisory (non-blocking) message in front of
    // Claude here, it has to go through hookSpecificOutput.additionalContext.
    const message = [
      `Harness OS - Context Bloat Warning`,
      `- Modified Files: ${modifiedCount}`,
      `- Accumulated Diff: ${totalDiffLines} lines`,
      ``,
      `Caution: Large number of modified files or big diffs will bloat the Agent context window, leading to:`,
      `  1. "Lost in the Middle" reasoning degradation`,
      `  2. Rapidly inflating token costs`,
      ``,
      `Recommended Action:`,
      `  - Run atomic commits or stage completed files.`,
      `  - Use targeted sub-folders rather than broad searches.`,
      `  - Ask user to run '/compact' or '/clear' if supported.`
    ].join('\n');

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message
      }
    }));
  }
} catch (err) {
  // Fail open - never block user execution on compaction checker
}

process.exit(0);

