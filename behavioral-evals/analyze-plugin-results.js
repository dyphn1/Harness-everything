#!/usr/bin/env node
/**
 * Analyze plugin eval results vs baseline
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');

function getCaseResult(data) {
  const passed = data.outcome === 'pass';
  const expectations = data.expectations;
  const passedCount = expectations.filter(e => e.pass).length;
  const totalCount = expectations.length;
  return { id: data.id, pressure: data.pressure, passed, passedCount, totalCount, expectations };
}

function analyzeResults() {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('plugin-') && f.endsWith('.json'))
    .map(f => path.join(RESULTS_DIR, f));
  
  // Group by case id, keep latest by date
  const byId = new Map();
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const existing = byId.get(data.id);
    if (!existing || data.date > existing.date) {
      byId.set(data.id, data);
    }
  }
  
  const results = Array.from(byId.values()).map(getCaseResult);
  
  const baseline = results.filter(r => !r.pressure);
  const pressure = results.filter(r => r.pressure);
  
  const baselinePassed = baseline.filter(r => r.passed).length;
  const pressurePassed = pressure.filter(r => r.passed).length;
  const totalPassed = results.filter(r => r.passed).length;
  
  console.log('=== Plugin Eval Results (31 cases) ===\n');
  
  console.log('Baseline Cases (n=17):');
  for (const r of baseline) {
    const status = r.passed ? '✅' : '❌';
    console.log(`  ${status} ${r.id}: ${r.passedCount}/${r.totalCount} expectations`);
  }
  console.log(`  Baseline Pass Rate: ${baselinePassed}/${baseline.length} = ${(baselinePassed/baseline.length*100).toFixed(1)}%\n`);
  
  console.log('Pressure Cases (n=14):');
  for (const r of pressure) {
    const status = r.passed ? '✅' : '❌';
    console.log(`  ${status} ${r.id}: ${r.passedCount}/${r.totalCount} expectations`);
  }
  console.log(`  Pressure Pass Rate: ${pressurePassed}/${pressure.length} = ${(pressurePassed/pressure.length*100).toFixed(1)}%\n`);
  
  console.log(`Overall: ${totalPassed}/${results.length} = ${(totalPassed/results.length*100).toFixed(1)}%`);
  
  // Compare with previous run (without plugin)
  console.log('\n=== Comparison with Previous Run (no plugin) ===');
  console.log('Previous (31 cases, no plugin):');
  console.log('  Overall: 67.7% (21/31) [95% CI: 51.2% - 84.2%]');
  console.log('  Baseline: 70.6% (12/17) [95% CI: 48.9% - 92.3%]');
  console.log('  Pressure: 64.3% (9/14) [95% CI: 39.2% - 89.4%]');
  console.log('\nCurrent (with plugin):');
  console.log(`  Overall: ${(totalPassed/results.length*100).toFixed(1)}% (${totalPassed}/${results.length})`);
  console.log(`  Baseline: ${(baselinePassed/baseline.length*100).toFixed(1)}% (${baselinePassed}/${baseline.length})`);
  console.log(`  Pressure: ${(pressurePassed/pressure.length*100).toFixed(1)}% (${pressurePassed}/${pressure.length})`);
  
  // Calculate delta
  const overallDelta = totalPassed/results.length - 0.677;
  const baselineDelta = baselinePassed/baseline.length - 0.706;
  const pressureDelta = pressurePassed/pressure.length - 0.643;
  
  console.log('\n=== Delta ===');
  console.log(`  Overall: ${(overallDelta*100).toFixed(1)}%`);
  console.log(`  Baseline: ${(baselineDelta*100).toFixed(1)}%`);
  console.log(`  Pressure: ${(pressureDelta*100).toFixed(1)}%`);
  
  // Verdict logic from issue #13
  console.log('\n=== Verdict (per Issue #13) ===');
  const effectivenessDelta = overallDelta * 100;
  const reliability = totalPassed / results.length;
  console.log(`  Effectiveness delta: ${effectivenessDelta.toFixed(1)}% (threshold: >10%)`);
  console.log(`  Reliability: ${(reliability*100).toFixed(1)}% (threshold: >=66.7%)`);
  
  if (effectivenessDelta > 10 && reliability >= 2/3) {
    console.log('  Verdict: EFFECTIVE ✅');
  } else if (effectivenessDelta > 0 && reliability >= 2/3) {
    console.log('  Verdict: MARGINAL ⚠️');
  } else if (effectivenessDelta < -10) {
    console.log('  Verdict: HARMFUL ❌');
  } else {
    console.log('  Verdict: INCONCLUSIVE ❓');
  }
  
  // Failed cases detail
  console.log('\n=== Failed Cases ===');
  const failed = results.filter(r => !r.passed);
  for (const r of failed) {
    console.log(`\n❌ ${r.id} (${r.pressure ? 'pressure' : 'baseline'}):`);
    for (const e of r.expectations) {
      if (!e.pass) console.log(`   - ${e.description}`);
    }
  }
}

analyzeResults();