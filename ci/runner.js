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
    // Claude Code feeds UserPromptSubmit hooks JSON on stdin (a "prompt"
    // field), not a CLI argument - match that here so this test actually
    // exercises the real interface instead of a path tier-router.js never
    // sees in production.
    const output = execSync(`node "${tierRouterPath}"`, {
      encoding: 'utf8',
      input: JSON.stringify({ prompt: data.prompt }),
      env: { ...process.env, HARNESS_EVAL: 'true' }
    });
    
    // Parse the human-readable classification. `Unclassified` is a first-class
    // result: no matched signal must never be converted back into Tier 1 by
    // the test harness itself.
    const tierMatch = output.match(/(?:RECOMMENDED|REQUIRED) TIER:\s*(Tier \d+|Unclassified)/i)
      || output.match(/\b(Tier \d+|Unclassified)\b/i);
    const actualTier = tierMatch ? tierMatch[1] : "Unknown";
    
    if (actualTier.toLowerCase().includes(String(data.expected_tier).toLowerCase())) {
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
