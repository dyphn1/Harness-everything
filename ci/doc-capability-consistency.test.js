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
  'docs/workflow-runtime.md',
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
  /mandatory evaluation\s*[,/]\s*advisory execution/i,
  /Tier-specific skills remain advisory/i,
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
  { name: 'general Codex installer boundary', re: /general `--codex` installer|Legacy\/general installer target/i },
  { name: 'Codex project skill target', re: /Codex[^\n]*`\.agents\/skills\/`/i },
  { name: 'Continue global skill target', re: /Continue\.dev[^\n]*`~\/\.continue\/skills\/`/i },
  { name: 'Hermes global skill target', re: /Hermes Agent[^\n]*`~\/\.hermes\/skills\/`/i },
  { name: 'Hermes trust boundary', re: /Hermes[^\n]{0,160}trust/i },
  { name: 'installer ownership boundary', re: /Install\/uninstall ownership boundary/i },
  { name: 'three-OS round-trip boundary', re: /Linux, Windows, and macOS/i },
]);

requireText('docs/platform-compatibility.json', [
  { name: 'machine-readable matrix format', re: /harness-platform-compatibility-v1/ },
  { name: 'ten-dimension coverage', re: /standaloneSkills[\s\S]*liveHostVerification/ },
  { name: 'official OpenAI source', re: /https:\/\/developers\.openai\.com\/plugins\/deploy\/submission/ },
  { name: 'Continue unknown discovery boundary', re: /"id": "continue"[\s\S]{0,3000}"status": "Unknown"/ },
]);

requireText('README.md', [
  { name: 'local Codex plugin surface', re: /Codex \/ local OpenAI plugin|local OpenAI plugin/i },
  { name: 'public Skills-only distinction', re: /Public OpenAI[^\n]*Skills-only|public OpenAI \*\*Skills-only\*\*/i },
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
]);

requireText('docs/architecture.md', [
  { name: 'Codex local plugin host adapter', re: /Codex[^\n]*local OpenAI plugin/i },
]);

requireText('VERIFICATION.md', [
  { name: 'mechanism/behavior distinction', re: /Mechanism evidence[\s\S]{0,700}Behavior evidence/i },
  { name: 'Codex local plugin verification surface', re: /Codex \/ local OpenAI plugin/i },
  { name: 'public Skills-only verification boundary', re: /Public OpenAI Skills-only/i },
  { name: 'live-host evidence layer', re: /Live-host evidence/i },
  { name: 'Codex repo Agent Skills path', re: /Codex[^\n]*`\.agents\/skills\/`/i },
  { name: 'Continue native global skills path', re: /`~\/\.continue\/skills\/`/i },
  { name: 'Hermes native global skills path', re: /`~\/\.hermes\/skills\/`/i },
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

const OPENCODE_EVIDENCE = 'benchmarks/results/live-host/opencode-2026-09-16/README.md';
const OPENCODE_SURFACES = [
  'README.md',
  'AGENTS.md',
  'BENCHMARK_SOP.md',
  'VERIFICATION.md',
  'docs/architecture.md',
  'docs/platform-capabilities.md',
  'docs/platform-compatibility.json',
  'opencode-plugin/README.md',
];

read(OPENCODE_EVIDENCE);
for (const rel of OPENCODE_SURFACES) {
  requireText(rel, [
    { name: 'OpenCode retained artifact path', re: /benchmarks\/results\/live-host\/opencode-2026-09-16\/README\.md/ },
    { name: 'OpenCode host/version/OS scope', re: /OpenCode 1\.18\.31[^\n]{0,40}macOS/i },
    { name: 'OpenCode project .js scope', re: /project[- ]scope[^\n]{0,100}\.js/i },
    { name: 'OpenCode loading and state evidence', re: /loading[^\n]{0,120}edit\/verification state/i },
    { name: 'OpenCode post-reset snapshot boundary', re: /post-reset/i },
    { name: 'OpenCode operator-seeded reflection boundary', re: /operator-seeded/i },
    { name: 'OpenCode hard-lock observation boundary', re: /hard[- ]lock[^\n]{0,100}interactive observation/i },
    { name: 'OpenCode missing blocked-tool trace', re: /no (?:retained )?blocked-tool trace/i },
    { name: 'OpenCode unverified remainder', re: /Global scope, npm-package installation, and other (?:OpenCode|host) versions remain unverified/i },
  ]);
  const text = read(rel);
  for (const re of [/fired the full (?:enforcement )?chain/i, /Hard, live-verified/i, /live (?:plugin )?loading remains unverified until/i]) {
    if (re.test(text)) fail(`${rel}: contains unsupported OpenCode claim ${re}`);
  }
}

const matrix = JSON.parse(read('docs/platform-compatibility.json'));
const opencode = matrix.platforms.find(platform => platform.id === 'opencode');
for (const dimension of ['hooksLifecycle', 'liveHostVerification']) {
  if (opencode?.capabilities[dimension]?.status !== 'Partial') {
    fail(`OpenCode ${dimension}: must remain Partial`);
  }
}
if (opencode?.capabilities.liveHostVerification.evidence !== OPENCODE_EVIDENCE) {
  fail('OpenCode liveHostVerification: missing exact retained artifact path');
}
for (const platform of matrix.platforms.filter(platform => platform.id !== 'opencode')) {
  if (platform.capabilities.liveHostVerification.status !== 'Unknown') {
    fail(`${platform.id}: liveHostVerification must remain Unknown without its own evidence`);
  }
}

const capabilitySummaryCount = read('docs/platform-capabilities.md').match(/^## Current capability summary$/gm)?.length;
if (capabilitySummaryCount !== 1) fail('docs/platform-capabilities.md: expected one current capability summary');

requireText('opencode-plugin/README.md', [
  { name: 'project install directory creation', re: /mkdir -p \.opencode\/plugins\s+cp opencode-plugin\/index\.mjs \.opencode\/plugins\/harness-enforcement\.js/ },
  { name: 'global install directory creation', re: /mkdir -p ~\/\.config\/opencode\/plugins\s+cp opencode-plugin\/index\.mjs ~\/\.config\/opencode\/plugins\/harness-enforcement\.js/ },
  { name: 'restart after installation', re: /restart OpenCode/i },
]);
if (/package names, not local file paths/i.test(read('opencode-plugin/README.md'))) {
  fail('opencode-plugin/README.md: incorrect local plugin path exclusion');
}

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
