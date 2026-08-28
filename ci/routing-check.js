#!/usr/bin/env node
/**
 * Routing Eval Local Gate
 *
 * Runs `waza spec verify` for every skill's eval.yaml to catch
 * routing regressions locally. Gracefully skips when waza is not installed.
 *
 * This is the local early-warning layer; CI's skill-quality job remains
 * the hard gate (runs on ubuntu-latest with waza CLI installed).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EVALS_DIR = path.join(ROOT, 'evals');

function discoverSkills() {
  const skills = [];
  for (const entry of fs.readdirSync(EVALS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const evalYaml = path.join(EVALS_DIR, entry.name, 'eval.yaml');
    if (fs.existsSync(evalYaml)) {
      skills.push({ name: entry.name, evalPath: evalYaml });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function checkWaza() {
  const result = spawnSync('waza', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function main() {
  const skills = discoverSkills();

  if (skills.length === 0) {
    console.log('No routing evals found in evals/');
    process.exit(0);
  }

  console.log(`Found ${skills.length} skills with routing evals.`);

  const hasWaza = checkWaza();

  if (!hasWaza) {
    console.warn('⚠️  waza CLI not found — skipping routing eval verification.');
    console.warn('   Install waza (https://github.com/microsoft/waza) to enable local routing checks.');
    console.warn('   CI skill-quality job remains the hard gate.');
    process.exit(0);
  }

  console.log('Running waza spec verify for each skill...\n');

  let failures = 0;

  for (const skill of skills) {
    console.log(`=== ${skill.name} ===`);
    const result = spawnSync(
      'waza',
      ['spec', 'verify', skill.name, skill.evalPath, '--fail', '--threshold', '1'],
      { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' }
    );

    if (result.status !== 0) {
      failures++;
      console.error(`❌ ${skill.name}: waza spec verify failed (exit ${result.status})`);
    } else {
      console.log(`✅ ${skill.name}: PASS`);
    }
  }

  console.log(`\n${skills.length - failures}/${skills.length} routing evals passed.`);

  if (failures > 0) {
    console.error(`\n❌ ${failures} routing eval(s) failed.`);
    process.exit(1);
  }

  console.log('\n🎉 ALL ROUTING EVALS PASSED.');
}

main();