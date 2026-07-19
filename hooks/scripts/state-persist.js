#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const stateFile = path.join(getWorkspaceRoot(), '.harness', 'handoff-state.json');

let inputData = '';
const timeout = setTimeout(() => {
  processState(null);
}, 200);

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const payload = JSON.parse(inputData.trim());
    processState(payload);
  } catch (err) {
    processState(null);
  }
});

function processState(payload) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });

    if (payload) {
      const exitCode = payload.exitCode;
      const isFailed = typeof exitCode === 'number' && exitCode !== 0;

      if (isFailed) {
        // Truncate output to avoid state bloat
        let output = payload.stdout || payload.stderr || payload.output || '';
        if (output.length > 500) {
          output = '...' + output.slice(-500);
        }

        const state = {
          status: 'failed',
          timestamp: new Date().toISOString(),
          tool: payload.tool || 'command',
          exitCode: exitCode,
          errorSummary: output.trim()
        };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      } else if (exitCode === 0) {
        // Clear failed state or mark as idle/resolved
        if (fs.existsSync(stateFile)) {
          const currentState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
          if (currentState.status === 'failed') {
            const state = {
              status: 'idle',
              timestamp: new Date().toISOString(),
              lastResolved: {
                tool: currentState.tool,
                timestamp: currentState.timestamp
              }
            };
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
          }
        }
      }
    } else {
      // No standard input payload, or invalid JSON. Just maintain a heartbeat timestamp
      if (!fs.existsSync(stateFile)) {
        const state = {
          status: 'idle',
          timestamp: new Date().toISOString()
        };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    }
  } catch (err) {
    // Fail silently in hooks
  }
  process.exit(0);
}

