#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const stateFile = path.join(process.cwd(), '.harness', 'rule-of-3-state.json');

try {
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    
    // If the same error signature has occurred 3 or more times, trigger the circuit breaker
    if (state.count >= 3 && !state.zoomOutResolved) {
      console.error(`[CRITICAL] RULE OF 3 CIRCUIT BREAKER TRIGGERED!`);
      console.error(`You have failed to resolve this issue after 3 attempts.`);
      console.error(`Error Signature: ${state.lastHash}`);
      console.error(`\nACTION REQUIRED:`);
      console.error(`1. CEASE FIRE immediately. Do not attempt another Bash, Edit, or Write.`);
      console.error(`2. Load the 'zoom-out' skill IMMEDIATELY.`);
      console.error(`3. Report this limit to your Human Partner and wait for new instructions.`);
      
      // Exit non-zero to block the PreToolUse hook
      process.exit(1);
    }
  }
  
  process.exit(0);
} catch (err) {
  // Fail open if state tracking breaks
  process.exit(0);
}
