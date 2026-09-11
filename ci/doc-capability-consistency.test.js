#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function fail(message) {
  console.error(`❌ ${message}`);
  failures++;
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`missing documentation surface: ${rel}`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

function requireText(rel, patterns) {
  const text = read(rel);
  for (const { name, re } of patterns) {
    if (!re.test(text)) fail(`${rel}: missing ${name}`);
    else pass(`${rel}: ${name}`);
  }
}

const CURRENT_SURFACES = [
  'README.md',
  'VERIFICATION.md',
  'docs/architecture.md',
  'docs/mechanism-first-skill-mesh.md',
  'docs/platform-capabilities.md',
  'docs/troubleshooting.md',
  'docs/openai-plugin.md',
  'submission/openai/README.md',
  'opencode-plugin/README.md',
];

// These phrases describe pre-#74 current state and must not reappear in current-state docs.
const STALE_PATTERNS = [
  /OpenAI\/Codex plugin hook packaging is tracked separately in \[#72\]/i,
  /Plugin adapter tracked in #72/i,
  /plugin target pending/i,
  /Codex[^\n]{0,120}adapter[^\n]{0,80}pending/i,
  /Only Claude Code gets the hard-boundary hooks/i,
  /Only possible on Claude Code \(the only platform with a hook\/exit-code execution system\)/i,
];

for (const rel of CURRENT_SURFACES) {
  const text = read(rel);
  for (const re of STALE_PATTERNS) {
    if (re.test(text)) fail(`${rel}: contains stale capability claim ${re}`);
  }
}

requireText('docs/platform-capabilities.md', [
  { name: 'local Codex plugin boundary', re: /Codex \/ local OpenAI plugin/i },
  { name: 'public Skills-only boundary', re: /Public OpenAI Skills-only plugin/i },
  { name: 'OpenCode live-unverified boundary', re: /live plugin loading remains unverified/i },
]);

requireText('README.md', [
  { name: 'local Codex plugin surface', re: /local OpenAI plugin/i },
  { name: 'public Skills-only distinction', re: /Skills-only/i },
  { name: 'OpenCode live-unverified qualifier', re: /OpenCode[^\n]*unverified live|opencode[^\n]*unverified live/i },
]);

requireText('docs/architecture.md', [
  { name: 'Codex local plugin host adapter', re: /Codex[^\n]*local OpenAI plugin/i },
  { name: 'OpenCode live loading remains unverified', re: /live (plugin )?loading remains unverified/i },
]);

requireText('VERIFICATION.md', [
  { name: 'mechanism/behavior distinction', re: /Mechanism[\s\S]{0,400}Behavior/i },
  { name: 'Codex local plugin verification surface', re: /Codex[^\n]*local OpenAI plugin/i },
  { name: 'public Skills-only verification boundary', re: /Skills-only/i },
]);

requireText('docs/openai-plugin.md', [
  { name: 'public submission excludes local hooks', re: /does \*\*not\*\* include the local `\.codex-plugin` lifecycle hooks/i },
]);

requireText('submission/openai/README.md', [
  { name: 'submission excludes local hooks', re: /does not contain the local `\.codex-plugin` lifecycle hooks/i },
]);

requireText('opencode-plugin/README.md', [
  { name: 'live OpenCode evidence limitation', re: /live[^\n]{0,120}unverified|not yet[^\n]{0,120}live/i },
]);

if (failures) {
  console.error(`\nDocumentation capability consistency: FAILED (${failures} issue${failures === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log('\nDocumentation capability consistency: PASSED');
