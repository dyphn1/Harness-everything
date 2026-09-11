#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Harness Kernel Router
 *
 * The tier-router remains the classifier and knowledge-guide detector. This
 * wrapper converts its output into the runtime contract Harness actually
 * wants hosts to follow: a very small set of mandatory invariants plus
 * optional skill suggestions. The model remains free to choose tactics and
 * skill order.
 */

function sanitizeClassifierOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const filtered = [];
  let skipLegacyContinuation = false;

  for (const line of lines) {
    if (line.includes('=> BASE EXECUTION LOOP:')) {
      skipLegacyContinuation = true;
      continue;
    }
    if (skipLegacyContinuation && line.includes('Track exactly ONE item in-progress')) {
      skipLegacyContinuation = false;
      continue;
    }
    skipLegacyContinuation = false;
    filtered.push(line);
  }

  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function detectTier(output) {
  const match = String(output).match(/=> RECOMMENDED TIER:\s*(Tier\s+[123])/i);
  return match ? match[1].replace(/\s+/g, ' ') : 'Tier 1';
}

function printKernelContract(tier) {
  console.log('\n=> REQUIRED HARNESS INVARIANTS:');
  console.log('   1. Route before execution: establish task scope/tier before mutating work.');
  console.log('   2. Verify before claim: completion claims require objective evidence appropriate to the change.');
  console.log('   3. Re-plan on repetition: after 3 same-signature failures, stop micro-retrying and zoom out/re-diagnose.');

  console.log('\n=> SUGGESTED SKILLS (ADVISORY — choose only what helps):');
  if (tier === 'Tier 1') {
    console.log('   - No mandatory domain skill. Prefer direct execution; load a focused skill only when it adds value.');
  } else if (tier === 'Tier 2') {
    console.log('   - todo-driven-workflow: useful when the task benefits from explicit multi-step progress tracking.');
    console.log('   - tdd: useful for behavioral changes where executable tests can drive the implementation.');
    console.log('   - verification-loop: useful for selecting the right build/lint/test/diff evidence before delivery.');
  } else {
    console.log('   - fable-mode / fable-discipline: useful for macro planning or deliberate multi-agent decomposition.');
    console.log('   - multi-agent-workspace: useful when bounded delegation materially improves the task.');
    console.log('   - todo-driven-workflow / tdd / verification-loop: use selectively when they fit the work.');
  }

  console.log('\n=> ORCHESTRATION POLICY: Do not enforce workflow order. Enforce the invariants above, then let the agent choose the smallest useful skill/tool set.');
}

function run(prompt, stdinPayload) {
  const classifierPath = path.join(__dirname, 'tier-router.js');
  const args = prompt ? [classifierPath, prompt] : [classifierPath];
  const result = spawnSync(process.execPath, args, {
    input: prompt ? undefined : stdinPayload,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error) {
    console.error(`[Harness Kernel] Failed to execute tier-router.js: ${result.error.message}`);
    process.exit(1);
  }

  const sanitized = sanitizeClassifierOutput(result.stdout);
  if (sanitized) console.log(sanitized);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);

  const tier = detectTier(result.stdout);
  printKernelContract(tier);
}

const prompt = process.argv.slice(2).join(' ');
if (prompt) {
  run(prompt, null);
} else if (process.stdin.isTTY) {
  run('', null);
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => run('', input));
}
