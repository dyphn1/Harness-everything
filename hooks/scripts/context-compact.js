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
    const border = "═".repeat(60);
    console.log(`\n╔${border}╗`);
    console.log(`║             Harness OS - Context Bloat Warning           ║`);
    console.log(`╠${border}╣`);
    console.log(`║ - Modified Files: ${String(modifiedCount).padEnd(41)} ║`);
    console.log(`║ - Accumulated Diff: ${String(totalDiffLines + ' lines').padEnd(39)} ║`);
    console.log(`║                                                          ║`);
    console.log(`║ Caution: Large number of modified files or big diffs     ║`);
    console.log(`║ will bloat the Agent context window, leading to:         ║`);
    console.log(`║   1. "Lost in the Middle" reasoning degradation          ║`);
    console.log(`║   2. Rapidly inflating token costs                       ║`);
    console.log(`║                                                          ║`);
    console.log(`║ Recommended Action:                                      ║`);
    console.log(`║   - Run atomic commits or stage completed files.         ║`);
    console.log(`║   - Use targeted sub-folders rather than broad searches. ║`);
    console.log(`║   - Ask user to run '/compact' or '/clear' if supported. ║`);
    console.log(`╚${border}╝\n`);
  }
} catch (err) {
  // Fail open - never block user execution on compaction checker
}

process.exit(0);

