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

// Guard: only materialize state in a workspace that actually has Harness
// installed. Without this, running a Claude session in any random folder
// (or using the agent for non-engineering chat) would still create
// state directories and session files there. A workspace counts as
// managed when it is a git repo AND carries at least one Harness install
// marker - or IS the harness-everything source repo itself (so manual
// VERIFICATION.md runs keep working after a fresh clone).
function isManagedWorkspace(wsRoot) {
  if (!fs.existsSync(path.join(wsRoot, '.git'))) return false;
  if (fs.existsSync(path.join(wsRoot, 'harness-everything', 'scripts', 'bootstrap.js'))) return true;
  const markers = [
    path.join(wsRoot, '.claude', 'settings.json'),
    path.join(wsRoot, '.cursorrules'),
    path.join(wsRoot, '.github', 'copilot-instructions.md'),
    path.join(wsRoot, 'AGENTS.md'),
    path.join(wsRoot, '.continue', 'rules', 'harness.md'),
    path.join(wsRoot, '.hermes.md'),
  ];
  return markers.some(m => fs.existsSync(m));
}

if (!isManagedWorkspace(root)) {
  // Stay completely silent: hooks must never surprise the user with files
  // or output in workspaces Harness was never installed into.
  process.exit(0);
}

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

  const isClaudeEnv = process.env.CLAUDE_CODE === 'true' || process.env.SHELL?.includes('claude-code') || false;
  const isCursorEnv = process.env.TERM_PROGRAM === 'cursor' || process.env.CURSOR_SANDBOX !== undefined || false;
  const isCopilotEnv = process.env.GITHUB_COPILOT_CHAT === 'true' || process.env.COPILOT_AGENT === '1' || process.env.AI_AGENT?.includes('copilot') || process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID !== undefined || false;

  const hasClaude = fs.existsSync(path.join(workspaceRoot, '.claude'));
  const hasCursor = fs.existsSync(path.join(workspaceRoot, '.cursorrules')) || fs.existsSync(path.join(workspaceRoot, '.cursor'));
  const hasCopilot = fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md'));
  const hasCodex = fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));

  const activePlatforms = {
    claude: isClaudeEnv || hasClaude,
    cursor: isCursorEnv || hasCursor,
    copilot: (!isClaudeEnv && !isCursorEnv && isCopilotEnv) || hasCopilot,
    codex: hasCodex
  };

  // If no platforms are active, fallback to current environment
  const hasAnyActive = Object.values(activePlatforms).some(v => v);
  if (!hasAnyActive) {
    if (isClaudeEnv) {
      activePlatforms.claude = true;
    } else if (isCursorEnv) {
      activePlatforms.cursor = true;
    } else {
      activePlatforms.copilot = true;
    }
  }

  const missing = [];
  if (activePlatforms.claude && !contains(path.join(workspaceRoot, '.claude', 'settings.json'), HOOK_ID)) {
    missing.push('.claude/settings.json (Claude Code hooks)');
  }
  if (activePlatforms.cursor && !contains(path.join(workspaceRoot, '.cursorrules'), MARKER)) {
    missing.push('.cursorrules (Cursor)');
  }
  if (activePlatforms.copilot && !contains(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), MARKER)) {
    missing.push('.github/copilot-instructions.md (Copilot)');
  }
  if (activePlatforms.codex && !contains(path.join(workspaceRoot, 'AGENTS.md'), MARKER)) {
    missing.push('AGENTS.md (Codex)');
  }

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

