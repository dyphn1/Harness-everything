#!/usr/bin/env node
/**
 * Circuit Breaker Hook
 * 
 * Enforces Rule of 3 for opencode.
 * This hook tracks failures and enforces the circuit breaker pattern:
 * 1. Tracks failure signatures
 * 2. Blocks edits after 3 failures on same signature
 * 3. Requires reflection (zoom-out) before resuming
 */

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.harness-state');
const BREAKER_FILE = path.join(STATE_DIR, 'circuit-breaker.json');

function loadBreakerState() {
  try {
    if (fs.existsSync(BREAKER_FILE)) {
      return JSON.parse(fs.readFileSync(BREAKER_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore parse errors
  }
  return {
    failures: {},
    hardLock: false,
    lastReflection: null
  };
}

function saveBreakerState(state) {
  fs.writeFileSync(BREAKER_FILE, JSON.stringify(state, null, 2));
}

function extractFailureSignature(errorOutput) {
  // Simple signature extraction: first 100 chars of error
  return errorOutput.slice(0, 100).replace(/\s+/g, ' ').trim();
}

function main() {
  const state = loadBreakerState();
  
  // Read input from stdin (error output from failed command)
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    const signature = extractFailureSignature(input);
    
    if (state.hardLock) {
      // Hard lock active - block all edits
      console.log(JSON.stringify({
        hook: 'circuit-breaker',
        action: 'block',
        reason: 'hard_lock',
        message: 'Circuit breaker hard-locked. Run npm run harness:reset or start new session.',
        signature
      }));
      process.exit(2);
    }
    
    // Track failure
    if (!state.failures[signature]) {
      state.failures[signature] = { count: 0, firstSeen: Date.now() };
    }
    
    state.failures[signature].count++;
    state.failures[signature].lastSeen = Date.now();
    
    // Check if we've hit the limit
    if (state.failures[signature].count >= 3) {
      // Check if reflection happened
      if (state.lastReflection && state.lastReflection > state.failures[signature].firstSeen) {
        // Reflection happened - this is a repeat trip = hard lock
        state.hardLock = true;
        saveBreakerState(state);
        
        console.log(JSON.stringify({
          hook: 'circuit-breaker',
          action: 'hard_lock',
          reason: 'repeat_trip_after_reflection',
          count: state.failures[signature].count,
          message: 'Same failure after reflection. Hard-locked. Need human intervention.',
          signature
        }));
        process.exit(2);
      } else {
        // No reflection yet - force reflection
        // Save state first so next invocation knows count >= 3
        saveBreakerState(state);
        
        console.log(JSON.stringify({
          hook: 'circuit-breaker',
          action: 'force_reflection',
          reason: 'three_failures',
          count: state.failures[signature].count,
          message: '3 failures on same signature. Must reflect (zoom-out) before retrying.',
          signature,
          instructions: 'Write zoom-out-report.md with: Goal, Failed Attempts, Verified Facts, Diagnosis, Decision'
        }));
        process.exit(2);
      }
    }
    
    // Under limit - allow but warn
    saveBreakerState(state);
    
    console.log(JSON.stringify({
      hook: 'circuit-breaker',
      action: 'allow',
      count: state.failures[signature].count,
      remaining: 3 - state.failures[signature].count,
      message: `Failure ${state.failures[signature].count}/3. ${3 - state.failures[signature].count} retries remaining.`,
      signature
    }));
  });
}

main();
