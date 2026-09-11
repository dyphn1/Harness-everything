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
  'AGENTS.md',
  'BENCHMARK_SOP.md',
  'VERIFICATION.md',
  'docs/architecture.md',
  'docs/mechanism-first-skill-mesh.md',
  'docs/philosophy.md',
  'docs/platform-capabilities.md',
  'docs/reflection.md',
  'docs/routing.md',
  'docs/troubleshooting.md',
  'docs/openai-plugin.md',
  'submission/openai/README.md',
  'opencode-plugin/README.md',
];

const STALE_PATTERNS = [
  /OpenAI\/Codex plugin hook packaging is tracked separately in \[#72\]/i,
  /Plugin adapter tracked in #72/i,
  /plugin target pending/i,
  /Codex[^\n]{0,120}adapter[^\n]{0,80}pending/i,
  /Only Claude Code gets the hard-boundary hooks/i,
  /Only possible on Claude Code \(the only platform with a hook\/exit-code execution system\)/i,
  /On platforms with no hook system at all \(Cursor, Copilot, Codex/i,
  /hooks[^\n]{0,100}Hard enforcement, Claude Code only/i,
  /Codex[^\n]{0,180}\.codex\/skills\//i,
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
  { name: 'general Codex installer boundary', re: /general `--codex` installer|Legacy\/general installer target/i },
  { name: 'Codex project skill target', re: /Codex[^\n]*`\.agents\/skills\/`/i },
  { name: 'Continue global skill target', re: /Continue\.dev[^\n]*`~\/\.continue\/skills\/`/i },
  { name: 'Hermes global skill target', re: /Hermes Agent[^\n]*`~\/\.hermes\/skills\/`/i },
  { name: 'Hermes trust boundary', re: /Hermes[^\n]{0,160}trust/i },
  { name: 'installer ownership boundary', re: /Install\/uninstall ownership boundary/i },
  { name: 'three-OS round-trip boundary', re: /Linux, Windows, and macOS/i },
]);

requireText('README.md', [
  { name: 'local Codex plugin surface', re: /Codex \/ local OpenAI plugin|local OpenAI plugin/i },
  { name: 'public Skills-only distinction', re: /Public OpenAI[^\n]*Skills-only|public OpenAI \*\*Skills-only\*\*/i },
  { name: 'OpenCode live-unverified qualifier', re: /OpenCode[^\n]*unverified live|OpenCode[^\n]*live loading remains unverified/i },
  { name: 'canonical matrix link', re: /docs\/platform-capabilities\.md/ },
  { name: 'Codex repo Agent Skills path', re: /Codex[^\n]*`?\.agents\/skills\/?`?/i },
  { name: 'Continue native global skills path', re: /`~\/\.continue\/skills\/`/i },
  { name: 'Hermes native global skills path', re: /`~\/\.hermes\/skills\/`/i },
  { name: 'installer round-trip evidence', re: /install[^\n]{0,40}(?:→|->)[^\n]{0,40}verify[^\n]{0,40}(?:→|->)[^\n]{0,40}uninstall/i },
]);

requireText('AGENTS.md', [
  { name: 'canonical platform matrix rule', re: /docs\/platform-capabilities\.md/ },
  { name: 'Codex local plugin distribution', re: /plugins\/harness-everything/ },
  { name: 'public Skills-only boundary', re: /public artifact does not include local `\.codex-plugin` lifecycle hooks/i },
]);

requireText('BENCHMARK_SOP.md', [
  { name: 'behavior vs mechanism separation', re: /behavior[^\n]{0,120}mechanism|mechanism\/live-host evidence/i },
  { name: 'Codex multi-surface distinction', re: /Codex \/ local OpenAI plugin|general Codex installer path/i },
  { name: 'OpenCode live-unverified qualifier', re: /OpenCode[^\n]*live loading remains unverified/i },
]);

requireText('docs/architecture.md', [
  { name: 'Codex local plugin host adapter', re: /Codex[^\n]*local OpenAI plugin/i },
  { name: 'OpenCode live loading remains unverified', re: /live (plugin )?loading remains unverified/i },
]);

requireText('VERIFICATION.md', [
  { name: 'mechanism/behavior distinction', re: /Mechanism evidence[\s\S]{0,700}Behavior evidence/i },
  { name: 'Codex local plugin verification surface', re: /Codex \/ local OpenAI plugin/i },
  { name: 'public Skills-only verification boundary', re: /Public OpenAI Skills-only/i },
  { name: 'live-host evidence layer', re: /Live-host evidence/i },
]);

requireText('docs/philosophy.md', [
  { name: 'platform-specific mechanism boundary', re: /platform-specific|installation surface/i },
  { name: 'canonical capability link', re: /platform-capabilities\.md/ },
  { name: 'automatic mechanism qualifier', re: /On surfaces that package|On integration surfaces that expose/i },
]);

requireText('docs/reflection.md', [
  { name: 'runtime state vs durable learning distinction', re: /Runtime session state[\s\S]{0,500}Durable workspace learning/i },
  { name: 'Codex local plugin WAL boundary', re: /Codex \/ local OpenAI plugin/i },
  { name: 'public Skills-only hook exclusion', re: /public OpenAI \*\*Skills-only\*\* artifact has no local `\.codex-plugin` lifecycle hooks/i },
]);

requireText('docs/routing.md', [
  { name: 'host-specific enforcement boundary', re: /Enforcement strength/i },
  { name: 'no cross-host parity inference', re: /do not infer cross-host parity/i },
]);

requireText('docs/troubleshooting.md', [
  { name: 'Codex advisory installer troubleshooting', re: /Codex advisory installer/i },
  { name: 'Codex local plugin troubleshooting', re: /Codex \/ local OpenAI plugin not appearing/i },
  { name: 'public Skills-only troubleshooting boundary', re: /Public OpenAI Skills-only plugin behaves differently/i },
]);

requireText('docs/openai-plugin.md', [
  { name: 'public submission excludes local hooks', re: /does \*\*not\*\* include the local `\.codex-plugin` lifecycle hooks/i },
]);

requireText('submission/openai/README.md', [
  { name: 'submission excludes local hooks', re: /does not contain the local `\.codex-plugin` lifecycle hooks/i },
]);

requireText('opencode-plugin/README.md', [
  { name: 'live OpenCode evidence limitation', re: /Live opencode plugin loading remains unverified/i },
]);

requireText('docs/audit.md', [
  { name: 'historical snapshot boundary', re: /Historical snapshot boundary/i },
  { name: 'current platform matrix link', re: /platform-capabilities\.md/ },
]);

requireText('CHANGELOG.md', [
  { name: 'OpenAI/Codex plugin packaging release note', re: /OpenAI\/Codex plugin packaging/i },
  { name: 'platform capability documentation drift gate release note', re: /platform capability documentation consistency|documentation capability drift/i },
]);

if (failures) {
  console.error(`\nDocumentation capability consistency: FAILED (${failures} issue${failures === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log('\nDocumentation capability consistency: PASSED');