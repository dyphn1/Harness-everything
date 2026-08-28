#!/usr/bin/env node
/**
 * Compliance Monitoring Hook
 * 
 * Tracks compliance metrics for Harness skills.
 * This hook monitors and reports:
 * 1. Verification compliance rate
 * 2. Circuit breaker trips
 * 3. Pressure resistance metrics
 */

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.harness-state');
const COMPLIANCE_FILE = path.join(STATE_DIR, 'compliance.json');

function loadCompliance() {
  try {
    if (fs.existsSync(COMPLIANCE_FILE)) {
      return JSON.parse(fs.readFileSync(COMPLIANCE_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore parse errors
  }
  return {
    sessionStart: Date.now(),
    totalEdits: 0,
    verifiedEdits: 0,
    blockedAttempts: 0,
    circuitBreakerTrips: 0,
    reflectionsForced: 0,
    pressureResistanceAttempts: 0,
    pressureResistanceSuccesses: 0
  };
}

function saveCompliance(state) {
  fs.writeFileSync(COMPLIANCE_FILE, JSON.stringify(state, null, 2));
}

function main() {
  const compliance = loadCompliance();
  
  // Read event from stdin
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      
      // Update compliance based on event
      switch (event.hook) {
        case 'post-edit-verification':
          compliance.totalEdits++;
          break;
          
        case 'pre-complete-verification':
          if (event.action === 'block') {
            compliance.blockedAttempts++;
          }
          break;
          
        case 'verification-runner':
          if (event.allPassed) {
            compliance.verifiedEdits++;
          }
          break;
          
        case 'circuit-breaker':
          if (event.action === 'force_reflection') {
            compliance.circuitBreakerTrips++;
            compliance.reflectionsForced++;
          } else if (event.action === 'hard_lock') {
            compliance.circuitBreakerTrips++;
          }
          break;
          
        case 'pressure-resistance':
          compliance.pressureResistanceAttempts++;
          if (event.resisted) {
            compliance.pressureResistanceSuccesses++;
          }
          break;
      }
      
      // Calculate metrics
      const verificationRate = compliance.totalEdits > 0 
        ? (compliance.verifiedEdits / compliance.totalEdits * 100).toFixed(1)
        : 0;
      
      const pressureResistanceRate = compliance.pressureResistanceAttempts > 0
        ? (compliance.pressureResistanceSuccesses / compliance.pressureResistanceAttempts * 100).toFixed(1)
        : 0;
      
      saveCompliance(compliance);
      
      // Output compliance report
      console.log(JSON.stringify({
        hook: 'compliance-monitor',
        action: 'report',
        metrics: {
          totalEdits: compliance.totalEdits,
          verifiedEdits: compliance.verifiedEdits,
          verificationRate: `${verificationRate}%`,
          blockedAttempts: compliance.blockedAttempts,
          circuitBreakerTrips: compliance.circuitBreakerTrips,
          reflectionsForced: compliance.reflectionsForced,
          pressureResistanceAttempts: compliance.pressureResistanceAttempts,
          pressureResistanceSuccesses: compliance.pressureResistanceSuccesses,
          pressureResistanceRate: `${pressureResistanceRate}%`
        },
        message: `Verification: ${verificationRate}% | Pressure Resistance: ${pressureResistanceRate}%`
      }));
      
    } catch (e) {
      // Invalid input
      console.log(JSON.stringify({
        hook: 'compliance-monitor',
        action: 'error',
        message: 'Invalid event data'
      }));
    }
  });
}

main();
