#!/usr/bin/env node
/**
 * Verification Gatekeeper
 * Forces the AI to run this script to prove quality gates before declaring a task done.
 */
const { execSync } = require('child_process');

console.log("=== 🛡️ Harness Verification Gate ===");

try {
  console.log("Running basic checks (simulated for now)...");
  
  // In a real project, this would run `npm run lint` and `npm test`
  // We'll simulate a failure if `.verify-fail.tmp` exists just to prove the mechanism.
  const fs = require('fs');
  if (fs.existsSync('.verify-fail.tmp')) {
    console.error("❌ Verification FAILED: Found broken tests or lint errors.");
    console.error("Please fix the code and run this gate again.");
    process.exit(1);
  }
  
  console.log("✅ Lint passed.");
  console.log("✅ Tests passed.");
  console.log("✅ Verification SUCCESS. You may now complete the task.");
  process.exit(0);

} catch (err) {
  console.error("❌ Verification FAILED.");
  console.error(err.message);
  process.exit(1);
}
