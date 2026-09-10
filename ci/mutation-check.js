#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const loader = path.join(__dirname, 'mutation-loader.js');
const checks = [
  ['physical path boundaries', 'scripts/lib/path-boundary.js', 'ci/mechanism-2v-verifier-boundaries.test.js'],
  ['exact execution commands', 'scripts/lib/execution-contract.js', 'ci/mechanism-2v-verifier-boundaries.test.js'],
  ['archive output boundaries', 'behavioral-evals/evidence-tool.js', 'ci/mechanism-2t-pr66-evidence-triage.test.js'],
  ['legacy migration boundaries', 'multi-agent-workspace/scripts/scaffold.js', 'ci/mechanism-2l-multi-agent-workspace.test.js'],
  ['global installer fallback', 'scripts/installer.js', 'ci/mechanism-2q-installer-global-shared-store.test.js'],
  ['transcript command qualifiers', 'behavioral-evals/transcript-parser.js', 'ci/mechanism-2t-transcript-parser.test.js'],
  ['fixture path boundaries', 'behavioral-evals/run.js', 'ci/mechanism-2j-behavioral-runner.test.js'],
  ['unbound workspace identity', 'scripts/lib/workspace.js', 'ci/mechanism-2u-issue-42-regressions.test.js'],
];

let failures = 0;
for (const [label, target, testFile] of checks) {
  const result = spawnSync(process.execPath, ['--require', loader, path.join(ROOT, testFile)], {
    cwd: ROOT,
    env: {
      ...process.env,
      HARNESS_MUTATION: {
        'scripts/lib/path-boundary.js': 'path-boundary',
        'scripts/lib/execution-contract.js': 'execution-contract',
        'behavioral-evals/evidence-tool.js': 'evidence-tool',
        'multi-agent-workspace/scripts/scaffold.js': 'scaffold-migration',
        'scripts/installer.js': 'installer-global',
        'behavioral-evals/transcript-parser.js': 'transcript-command',
        'behavioral-evals/run.js': 'runner-fixture',
        'scripts/lib/workspace.js': 'workspace-identity',
      }[target],
      HARNESS_MUTATION_TARGET: path.join(ROOT, target),
      NODE_OPTIONS: `--require=${loader}`,
    },
    encoding: 'utf8'
  });
  if (result.status === 0) {
    console.error(`FAIL mutation survived: ${label} (${target})`);
    failures++;
  } else {
    console.log(`PASS mutation was caught: ${label} (${testFile})`);
  }
}

if (failures) {
  console.error(`Mutation check failed: ${failures} mutation(s) survived.`);
  process.exit(1);
}
console.log(`Mutation check passed: ${checks.length} production mutations were rejected by focused tests.`);
