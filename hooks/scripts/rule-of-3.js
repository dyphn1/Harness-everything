#!/usr/bin/env node
// Rule of 3 circuit breaker (PreToolUse: Bash|PowerShell|Edit|Write).
//
// Tripping the breaker forces REFLECTION, not surrender. The most common
// agent failure mode is drilling deeper on one unverified assumption, so the
// breaker locks mutating tools and demands a zoom-out fact-check first
// (read-only tools stay available). A valid reflection report - written to
// the session's zoom-out-report.md (path given in the block message below) -
// releases the breaker again. Only a SECOND trip on the same failure
// signature - proof that reflection alone couldn't crack it - hard-locks the
// session until the Human Partner decides.
//
// State is scoped per Claude Code session_id (see lib/harness-state.js) so
// two sessions open on the same repo never share a trip count. The common
// case - nobody's breaker tripped anywhere - never has to read stdin to find
// that out; only once some session IS tripped do we pay to read the payload
// and check whether it's this one.
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, listSessionDirs } = require('./lib/harness-state');

const REQUIRED_SECTIONS = [
  '## Goal',
  '## Failed Attempts',
  '## Verified Facts',
  '## Diagnosis',
  '## Decision'
];

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (err) { return null; }
}

function isTripped(state) {
  return !!state && state.count >= 3 && !state.zoomOutResolved;
}

function anySessionTripped(root) {
  return listSessionDirs(root).some(dir => isTripped(readState(path.join(dir, 'rule-of-3-state.json'))));
}

// The one mutation allowed while tripped: writing the reflection report.
function isReportWrite(payload, reportFile) {
  if (!payload) return false;
  if (payload.tool_name !== 'Write' && payload.tool_name !== 'Edit') return false;
  const target = payload.tool_input && payload.tool_input.file_path;
  if (!target) return false;
  return path.resolve(target).toLowerCase() === path.resolve(reportFile).toLowerCase();
}

// A report only counts if it was written AFTER the failure that tripped the
// breaker (a stale report from an earlier loop can't unlock a new one), has
// every required section, and actually committed to a RESUME/ESCALATE call.
function reportIsValid(state, reportFile) {
  if (!fs.existsSync(reportFile)) return false;
  if (fs.statSync(reportFile).mtimeMs < (state.lastFailureAt || 0)) return false;
  const text = fs.readFileSync(reportFile, 'utf8');
  if (!REQUIRED_SECTIONS.every(h => text.includes(h))) return false;
  return /\b(RESUME|ESCALATE)\b/.test(text);
}

function blockForReflection(state, reportFile) {
  console.error(`[CRITICAL] RULE OF 3 CIRCUIT BREAKER TRIGGERED!`);
  console.error(`The same failure signature has now occurred 3 times.`);
  console.error(`Error Signature: ${state.lastHash}`);
  console.error(`\nMutating tools (Bash/PowerShell/Edit/Write) are locked - not because you`);
  console.error(`must wait for a human, but because you must stop drilling and rebuild the`);
  console.error(`full picture first. Do NOT ask the Human Partner yet.`);
  console.error(`\nACTION REQUIRED (reflect first):`);
  console.error(`1. CEASE FIRE. No new fix attempts, no variations of the last one.`);
  console.error(`2. Load the 'zoom-out' skill and follow its Reflect & Fact-Check protocol.`);
  console.error(`3. Using READ-ONLY tools (Read/Grep/Glob - still available), re-verify the`);
  console.error(`   assumption behind each failed attempt against the actual code/logs/docs.`);
  console.error(`4. Write your findings to '${reportFile}' (the ONLY write`);
  console.error(`   allowed right now) with sections: ## Goal, ## Failed Attempts,`);
  console.error(`   ## Verified Facts, ## Diagnosis, ## Decision (ending RESUME: or ESCALATE:).`);
  console.error(`\nA valid report releases this breaker automatically. Escalate to the Human`);
  console.error(`Partner ONLY if your Decision concludes a genuinely human call is needed`);
  console.error(`(requirement conflict, architecture trade-off, destructive action, missing`);
  console.error(`access) - and then present options with a recommendation, not apologies.`);
  // For PreToolUse, only exit code 2 actually blocks the tool call.
  // Exit 1 is a non-blocking error and Claude Code proceeds anyway.
  process.exit(2);
}

function blockForHumanDecision(state) {
  console.error(`[CRITICAL] RULE OF 3 CIRCUIT BREAKER TRIGGERED! (repeat trip - hard lock)`);
  console.error(`Error Signature: ${state.lastHash}`);
  console.error(`\nYou already completed a zoom-out reflection for this same failure signature`);
  console.error(`and the fresh diagnosis failed too. This is now past reflect-and-retry:`);
  console.error(`STOP and hand the decision to your Human Partner.`);
  console.error(`\nPresent a DECISION REQUEST, not a plea: the goal, the verified facts, every`);
  console.error(`path already falsified (including the post-reflection diagnosis), 2-3`);
  console.error(`concrete options with trade-offs, and your recommendation.`);
  console.error(`\nThis lock persists until the Human Partner clears it by running`);
  console.error(`"npm run harness:reset" in their own terminal, or by starting a new`);
  console.error(`session / running /clear (which resets it automatically on SessionStart).`);
  process.exit(2);
}

function main(payload) {
  try {
    const root = getWorkspaceRoot();
    const sessionDir = getSessionDir(root, payload && payload.session_id);
    const stateFile = path.join(sessionDir, 'rule-of-3-state.json');
    const reportFile = path.join(sessionDir, 'zoom-out-report.md');

    const state = readState(stateFile);
    if (!isTripped(state)) {
      process.exit(0);
    }

    if (isReportWrite(payload, reportFile)) {
      process.exit(0);
    }

    if (reportIsValid(state, reportFile)) {
      state.count = 0;
      state.zoomOutResolved = true;
      state.zoomOutCycles = (state.zoomOutCycles || 0) + 1;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      console.log(
        `[Rule of 3] Zoom-out report accepted - breaker released. Follow your ` +
        `report's Decision: RESUME means one fresh run at the NEW diagnosis; ` +
        `ESCALATE means present the decision request and WAIT for the Human ` +
        `Partner before mutating anything. If this same signature trips the ` +
        `breaker again, it hard-locks for a human decision.`
      );
      process.exit(0);
    }

    if ((state.zoomOutCycles || 0) >= 1) {
      blockForHumanDecision(state);
    }
    blockForReflection(state, reportFile);
  } catch (err) {
    // Fail open if state tracking breaks
    process.exit(0);
  }
}

// Fast path: skip stdin entirely unless some session's breaker is actually
// tripped (also keeps manual terminal runs instant).
let tripped = false;
try {
  tripped = anySessionTripped(getWorkspaceRoot());
} catch (err) {
  tripped = false; // fail open
}

if (!tripped) {
  process.exit(0);
}

if (process.stdin.isTTY) {
  // Manual run in a terminal - no payload is coming.
  main(null);
} else {
  let raw = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    let payload = null;
    try { payload = JSON.parse(raw); } catch (err) { /* no payload */ }
    main(payload);
  };
  // Claude Code closes stdin right after writing the payload; the timer is a
  // safety net so an odd caller that never closes stdin can't hang the hook.
  const timer = setTimeout(finish, 300);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => { clearTimeout(timer); finish(); });
  process.stdin.on('error', () => { clearTimeout(timer); finish(); });
}
