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

  // All prompts, including any legacy approval spelling, pass through unchanged
  // to the normal router. Harness does not parse or intercept authorization
  // syntax in user prompts; native agent/task scope and native permissions
  // remain authoritative.
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
