#!/usr/bin/env node
'use strict';

const { run } = require('./subagent-scope-guard');

// Codex accepts warnings through systemMessage on SubagentStop. Keep the
// audit advisory and leave stdout empty when there is nothing to reconcile.
const warnings = [];
run({
  info() {},
  warn(message) { warnings.push(message); },
  complete() {
    if (warnings.length > 0) {
      process.stdout.write(JSON.stringify({ systemMessage: warnings.join('\n') }) + '\n');
    }
  },
});
