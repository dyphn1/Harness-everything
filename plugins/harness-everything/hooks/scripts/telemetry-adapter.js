#!/usr/bin/env node
'use strict';

const { recordSkillHook } = require('./lib/telemetry');

let input = '';
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  try {
    const payload = input.trim() ? JSON.parse(input) : {};
    recordSkillHook(payload);
  } catch (_) {
    // Telemetry must never affect the task lifecycle.
  }
  process.exit(0);
}

const timer = setTimeout(finish, 300);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => { clearTimeout(timer); finish(); });
process.stdin.on('error', () => { clearTimeout(timer); finish(); });
