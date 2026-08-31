#!/usr/bin/env node
/**
 * Routing Eval Local Gate
 * 
 * Runs `waza spec verify` for all skills' eval.yaml files.
 * A missing waza installation is an explicit non-pass. CI installs waza, and
 * local callers should not mistake an infrastructure skip for coverage.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EVALS_DIR = path.join(ROOT, 'evals');

function checkWaza() {
  try {
    const r = spawnSync('waza', ['--version'], { stdio: 'ignore', shell: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

function discoverSkills() {
  const skills = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = path.join(ROOT, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    skills.push(entry.name);
  }
  return skills.sort();
}

function runRoutingCheck() {
  console.log('=== Routing Eval Check ===\n');
  
  if (!checkWaza()) {
    console.error('waza not installed: routing eval check is NOT RUN');
    console.log('   Install with: npm i -g @microsoft/waza');
    process.exit(2);
  }
  
  const skills = discoverSkills();
  console.log(`Found ${skills.length} skills with routing evals\n`);
  
  let failed = 0;
  let passed = 0;
  
  for (const skill of skills) {
    const evalPath = path.join(EVALS_DIR, skill, 'eval.yaml');
    if (!fs.existsSync(evalPath)) {
      console.log(`❌ ${skill}: no eval.yaml found`);
      failed++;
      continue;
    }
    
    console.log(`Checking ${skill}...`);
    const r = spawnSync('waza', ['spec', 'verify', skill, evalPath, '--fail', '--threshold', '1'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true
    });
    
    if (r.status === 0) {
      console.log(`  ✅ PASS`);
      passed++;
    } else {
      console.log(`  ❌ FAIL`);
      console.log(`     ${r.stderr || r.stdout}`);
      failed++;
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n❌ ROUTING EVAL CHECK FAILED');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ROUTING EVALS PASSED');
    process.exit(0);
  }
}

runRoutingCheck();
