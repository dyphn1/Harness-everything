#!/usr/bin/env node
'use strict';
// Codex UserPromptSubmit adapter (docs/system-one-observations.md#hosts).
// Codex adds prompt-time context to the model only from JSON
// hookSpecificOutput.additionalContext; the router's plain stdout never
// reaches the model. This runs the kernel router and wraps its output.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Packaged plugin layout first, then the canonical repository layout.
const ROUTER = [
  path.join(__dirname, '..', '..', 'skills', 'harness-everything', 'scripts', 'kernel-router.js'),
  path.join(__dirname, '..', '..', 'harness-everything', 'scripts', 'kernel-router.js'),
].find(file => fs.existsSync(file));

let input = '';
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(timer);

  let payload = null;
  try { payload = JSON.parse(input || '{}'); } catch (_) { payload = null; }

  // Codex explicit authorization: only an exact host-submitted consent prompt
  // may bind a pending challenge to the host session + consent turn. No
  // natural-language inference, no tool-input claim.
  if (payload && payload.hook_event_name === 'UserPromptSubmit') {
    const prompt = payload.prompt;
    const match = String(prompt || '').match(/^HARNESS APPROVE ([A-Za-z0-9._-]{8,})$/);
    if (match) {
      try {
        const auth = require('./lib/codex-action-authorization');
        auth.bindConsent(payload, { challengeId: match[1] });
      } catch (_) { /* consent state is best-effort; failures do not authorize */ }
      process.exit(0);
      return;
    }
  }

  if (!ROUTER) process.exit(0);
  const result = spawnSync(process.execPath, [ROUTER], { input, encoding: 'utf8', env: process.env, timeout: 25000 });
  const stderr = String(result.stderr || '');
  if (stderr) process.stderr.write(stderr);
  const registryDiagnostics = stderr.split(/\r?\n/)
    .filter(line => line.includes('cannot load step-type registry') && /(repair|restore|plugin:sync)/i.test(line));
  const context = [String(result.stdout || '').trim(), ...registryDiagnostics].filter(Boolean).join('\n').trim();
  if (context) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
  }
  process.exit(0);
}

const timer = setTimeout(finish, 1000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', finish);
process.stdin.on('error', finish);
