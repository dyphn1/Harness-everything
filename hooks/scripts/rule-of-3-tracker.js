#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// PostToolUse hooks in Claude Code typically receive the tool output via stdin
let inputData = '';

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    const exitCode = payload.exitCode; // Assuming standard schema
    const output = payload.stdout || payload.stderr || payload.output || '';
    
    const stateDir = path.join(process.cwd(), '.harness');
    const stateFile = path.join(stateDir, 'rule-of-3-state.json');
    
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    
    let state = { count: 0, lastHash: null, zoomOutResolved: false };
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    // Only track failures
    if (exitCode !== 0 && output) {
      // Create a hash of the last 200 chars of the error to identify identical loops
      const errorStr = output.slice(-200).trim();
      const hash = crypto.createHash('md5').update(errorStr).digest('hex');
      
      if (state.lastHash === hash) {
        state.count += 1;
      } else {
        state.count = 1;
        state.lastHash = hash;
        state.zoomOutResolved = false;
      }
      
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    } else if (exitCode === 0) {
      // If a command succeeds, we might reset the counter, 
      // but only if it's a substantive command (we'll do a simple reset here for now)
      if (state.count > 0) {
        state.count = 0;
        state.zoomOutResolved = true;
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }
    
  } catch (err) {
    // silently fail
  }
  process.exit(0);
});
