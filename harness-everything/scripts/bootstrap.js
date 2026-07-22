#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  getWorkspaceRoot,
  getSessionDir,
  writeCurrentSession,
  pruneStaleSessions,
} = require('../../hooks/scripts/lib/harness-state');

console.log("Bootstrapping Harness Skills OS...");

// SessionStart hooks receive a payload with session_id via stdin, same as
// every other hook. Read it synchronously up front - bootstrap has no
// tool-call latency to protect, so there's no fast-path tradeoff here - but
// skip entirely on an interactive TTY (manual run) where reading fd 0 would
// just hang waiting for input that's never coming.
let payload = null;
if (!process.stdin.isTTY) {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    payload = JSON.parse(raw);
  } catch (err) {
    // No payload piped in, or invalid JSON - fall back to 'default'.
  }
}
const sessionId = payload && payload.session_id;

const root = getWorkspaceRoot();

// Nothing purges old session directories the way an OS temp dir would -
// drop ones untouched for a while so .claude/harness-state/sessions/ doesn't
// grow forever.
pruneStaleSessions(root);

// The manual escape hatch (reset-circuit-breaker.js) and any CLI tool that
// can't see a session_id (todo-cli.js) resolve "current session" through
// this pointer.
writeCurrentSession(root, sessionId);

const harnessDir = getSessionDir(root, sessionId);

// The Rule of 3 circuit breaker (hooks/scripts/rule-of-3.js) locks all
// Bash/Edit/Write calls once tripped; the only in-session exits are a valid
// zoom-out reflection report or a human reset. A new SessionStart means the
// human has taken over (new session, /clear, /compact) and reviewed the
// situation, so it's safe to clear here. The stale reflection report goes
// with it - it belongs to the previous loop, not this session.
const circuitBreakerFile = path.join(harnessDir, 'rule-of-3-state.json');
if (fs.existsSync(circuitBreakerFile)) {
  try {
    fs.unlinkSync(circuitBreakerFile);
    console.log("Rule of 3 circuit breaker state cleared for new session.");
  } catch (err) {
    // Ignore; worst case the breaker stays tripped until manually reset.
  }
}
const zoomOutReportFile = path.join(harnessDir, 'zoom-out-report.md');
if (fs.existsSync(zoomOutReportFile)) {
  try {
    fs.unlinkSync(zoomOutReportFile);
  } catch (err) {
    // Ignore; rule-of-3.js already rejects reports older than the last failure.
  }
}

// Same reasoning: a stale subagent-scope baseline from a previous session
// would make the first Task burst of this session diff against the wrong
// starting point.
const subagentScopeFile = path.join(harnessDir, 'subagent-scope-state.json');
if (fs.existsSync(subagentScopeFile)) {
  try {
    fs.unlinkSync(subagentScopeFile);
  } catch (err) {
    // Ignore.
  }
}

// Self-heal audit: report missing platform integration touchpoints so the
// model (per harness-everything SKILL.md) repairs them via self-heal.js.
// Audit-and-report only - bootstrap never writes these files itself, so a
// user who intentionally removed one isn't fought every session start.
try {
  const MARKER = 'Harness OS Guidance (Advisory)';
  const HOOK_ID = 'harness:pre:bootstrap';
  const workspaceRoot = getWorkspaceRoot();
  const contains = (p, needle) => {
    try { return fs.readFileSync(p, 'utf8').includes(needle); } catch (e) { return false; }
  };
  const missing = [
    ['.claude/settings.json (Claude Code hooks)', contains(path.join(workspaceRoot, '.claude', 'settings.json'), HOOK_ID)],
    ['.cursorrules (Cursor)', contains(path.join(workspaceRoot, '.cursorrules'), MARKER)],
    ['.github/copilot-instructions.md (Copilot)', contains(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), MARKER)],
    ['AGENTS.md (Codex)', contains(path.join(workspaceRoot, 'AGENTS.md'), MARKER)]
  ].filter(([, ok]) => !ok).map(([label]) => label);
  if (missing.length > 0 && path.resolve(workspaceRoot) !== path.resolve(__dirname, '..', '..')) {
    console.log(`\n[Self-Heal] Missing integration touchpoints: ${missing.join(', ')}`);
    console.log(`[Self-Heal] Repair (idempotent): node "${path.join(__dirname, 'self-heal.js')}"`);
  }
} catch (err) {
  // Audit is best-effort; never block session start.
}

// Check for handoff/state checkpoint from previous session
const handoffFile = path.join(harnessDir, 'handoff-state.json');
if (fs.existsSync(handoffFile)) {
  try {
    const handoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    if (handoff.status === 'failed') {
      const exitStr = handoff.exitCode ? ` (exit code ${handoff.exitCode})` : '';
      const border = "─".repeat(60);
      console.log(`\n┌${border}┐`);
      console.log(`│             Harness OS - Handoff Checkpoint              │`);
      console.log(`├${border}┤`);
      console.log(`│ - Last active action failed${exitStr.padEnd(30)} │`);
      console.log(`│ - Action: ${String(handoff.tool || 'unknown').padEnd(46)} │`);
      console.log(`│ - Last error output snippet:                             │`);
      
      const snippet = handoff.errorSummary || 'No snippet available';
      const lines = snippet.split('\n').map(l => l.trim()).filter(Boolean).slice(-3);
      if (lines.length > 0) {
        lines.forEach(line => {
          const paddedLine = line.slice(0, 54).padEnd(54);
          console.log(`│     > ${paddedLine} │`);
        });
      } else {
        console.log(`│     > None                                               │`);
      }
      console.log(`├${border}┤`);
      console.log(`│ Hint: Use this context to continue resolving the issue   │`);
      console.log(`│       efficiently or start on a new path.                │`);
      console.log(`└${border}┘\n`);
    }
  } catch (err) {
    // Ignore malformed files
  }
}

console.log("Harness OS initialized. Ready for user prompt.");

