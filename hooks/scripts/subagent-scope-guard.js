#!/usr/bin/env node
/**
 * Subagent Scope Guard (PreToolUse + PostToolUse: Task)
 * Grounded in a real incident: a subagent briefed as "read-only, verify and
 * report a verdict" still had full tool access by default and made
 * substantial unrequested edits (a GitBook restructure, ~115 deleted lines)
 * in a large parallel fan-out. It was only caught because someone happened
 * to run `git status` on the whole repo afterward.
 *
 * This hook makes that check automatic instead of relying on remembering to
 * do it: PreToolUse snapshots `git status --porcelain` the first time a Task
 * spawn starts (shared baseline across any parallel/nested Task calls in the
 * same burst), PostToolUse diffs the current status against that baseline
 * and surfaces every changed file - not just the ones the task was expected
 * to touch, since "expected" can't be reliably inferred from a natural-
 * language task brief. It cannot block (the subagent already ran), only
 * makes the diff impossible to miss.
 * Fails open on any error - this is visibility, not a hard gate.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');

function gitStatus(root) {
  try {
    return execSync('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    return null;
  }
}

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    if (payload.tool_name !== 'Task') process.exit(0);

    const root = getWorkspaceRoot();
    const stateFile = path.join(getSessionDir(root, payload.session_id), 'subagent-scope-state.json');

    if (payload.hook_event_name === 'PreToolUse') {
      // Only set the baseline if one isn't already pending - parallel/nested
      // Task calls in the same burst share it, so the eventual diff covers
      // everything the whole burst touched, not just the last one.
      if (!fs.existsSync(stateFile)) {
        const status = gitStatus(root);
        if (status !== null) {
          fs.writeFileSync(stateFile, JSON.stringify({ baseline: status }, null, 2), 'utf8');
        }
      }
      process.exit(0);
    }

    if (payload.hook_event_name === 'PostToolUse') {
      if (!fs.existsSync(stateFile)) process.exit(0);

      const { baseline } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const current = gitStatus(root);
      if (current === null) process.exit(0);

      const baselineLines = new Set(baseline.split('\n').filter(Boolean));
      const currentLines = current.split('\n').filter(Boolean);
      const newlyChanged = currentLines.filter(line => !baselineLines.has(line));

      if (newlyChanged.length > 0) {
        console.error(`[Subagent Scope Guard] ${newlyChanged.length} file(s) changed since this Task burst started:`);
        newlyChanged.forEach(line => console.error(`  ${line}`));
        console.error(`Confirm every one of these was actually in scope before trusting or committing this output.`);
        console.error(`Do not "git add -A" - stage files explicitly by path so anything unexpected here stays visible.`);
      }

      // Roll the baseline forward so the next Task burst only reports what's
      // new since this report, not the same files over and over.
      fs.writeFileSync(stateFile, JSON.stringify({ baseline: current }, null, 2), 'utf8');

      if (newlyChanged.length > 0) {
        process.exit(2);
      }
      process.exit(0);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
