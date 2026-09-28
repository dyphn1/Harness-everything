#!/usr/bin/env node
'use strict';
// Records System One turn observations (docs/system-one-observations.md).
// Fail-open and silent: it never writes to stdout, never blocks, and exits 0.

let input = '';
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  try {
    const payload = input.trim() ? JSON.parse(input) : null;
    if (payload) require('./lib/observations').handle(payload);
  } catch (_) {
    // Observation must never affect the turn.
  }
  process.exit(0);
}

const timer = setTimeout(finish, 1500);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => { clearTimeout(timer); finish(); });
process.stdin.on('error', () => { clearTimeout(timer); finish(); });
