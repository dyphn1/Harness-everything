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

  const overThreshold = modifiedCount >= HIGH_FILE_LIMIT || totalDiffLines >= HIGH_LINE_LIMIT;

  // Throttle: this hook fires on EVERY Bash/Edit/Write call, and a warning
  // about context bloat that repeats on every call becomes context bloat
  // itself (and trains the model to ignore hook output). Warn on the first
  // crossing, then only every 10th call while still over - or when the diff
  // has grown another 50% since the last warning.
  const stateDir = path.join(process.cwd(), '.harness');
  const stateFile = path.join(stateDir, 'context-compact-state.json');
  let state = { overCount: 0, lastWarnedLines: 0 };
  try {
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (err) { /* use default */ }

  if (!overThreshold) {
    if (state.overCount > 0) {
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ overCount: 0, lastWarnedLines: 0 }), 'utf8');
      } catch (err) { /* ignore */ }
    }
    process.exit(0);
  }

  state.overCount += 1;
  const onBeat = state.overCount === 1 || state.overCount % 10 === 0;
  const grewALot = totalDiffLines >= (state.lastWarnedLines || 0) * 1.5 && totalDiffLines > state.lastWarnedLines;
  const shouldWarn = onBeat || grewALot;
  if (shouldWarn) state.lastWarnedLines = totalDiffLines;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
  } catch (err) { /* ignore */ }

  if (shouldWarn) {
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

