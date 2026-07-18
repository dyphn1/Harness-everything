#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const casesDir = path.join(__dirname, 'cases');
const files = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));

console.log("=== Harness Tier Verification Framework ===");
console.log("This framework simulates routing prompts to verify trigger rates.\n");

let passed = 0;
let failed = 0;

files.forEach(file => {
  const data = JSON.parse(fs.readFileSync(path.join(casesDir, file), 'utf8'));
  console.log(`[Testing] ${data.name}`);
  console.log(`  Prompt: "${data.prompt}"`);
  console.log(`  Expected Tier: ${data.expected_tier}`);
  
  try {
    const tierRouterPath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'tier-router.js');
    // Call tier-router.js with the prompt
    const output = execSync(`node "${tierRouterPath}" "${data.prompt}"`, { encoding: 'utf8' });
    
    // Parse the output to find the recommended tier
    const tierMatch = output.match(/REQUIRED TIER: (Tier \d+)/i) || output.match(/(Tier \d+)/i);
    const actualTier = tierMatch ? tierMatch[1] : "Unknown";
    
    if (actualTier.includes(data.expected_tier)) {
      console.log(`  -> Result: PASS (Got ${actualTier})\n`);
      passed++;
    } else {
      console.log(`  -> Result: FAIL (Expected ${data.expected_tier}, Got ${actualTier})\n`);
      console.log(`  Output was:\n${output}`);
      failed++;
    }
  } catch (err) {
    console.log(`  -> Result: ERROR executing router`);
    failed++;
  }
});

console.log(`--- Summary: ${passed} passed, ${failed} failed ---`);
if (failed > 0) {
  process.exit(1);
}

