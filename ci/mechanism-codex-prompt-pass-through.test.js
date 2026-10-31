#!/usr/bin/env node
'use strict';

// RED contract: Codex UserPromptSubmit must pass every prompt, including the
// former exact `HARNESS APPROVE <id>` spelling, to the normal router. The hook
// is transport, not a natural-language authorization parser.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_HOOK = path.join(ROOT, 'hooks', 'scripts', 'codex-user-prompt.js');

let failed = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}

// Dependency control: source hook must exist. Child Node is run with the
// executable that is already running this test.
check(fs.existsSync(SOURCE_HOOK), 'source codex-user-prompt.js exists');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-prompt-passthrough-'));
const fixtureRoot = path.join(tempRoot, 'fixture');
const hookDir = path.join(fixtureRoot, 'hooks', 'scripts');
const routerDir = path.join(fixtureRoot, 'harness-everything', 'scripts');
fs.mkdirSync(hookDir, { recursive: true });
fs.mkdirSync(routerDir, { recursive: true });
const fixtureHook = path.join(hookDir, 'codex-user-prompt.js');
const stubRouter = path.join(routerDir, 'kernel-router.js');
const markerFile = path.join(tempRoot, 'router-marker.txt');

fs.copyFileSync(SOURCE_HOOK, fixtureHook);
fs.writeFileSync(stubRouter, [
  "'use strict';",
  "let input = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', chunk => { input += chunk; });",
  "process.stdin.on('end', () => {",
  "  const fs = require('fs');",
  "  fs.writeFileSync(process.env.STUB_ROUTER_MARKER, input, 'utf8');",
  "  process.stdout.write('STUB_ROUTER_MARKER');",
  "  process.exit(0);",
  "});",
  "process.stdin.on('error', () => process.exit(0));",
].join('\n'), 'utf8');

const cases = [
  { name: 'normal user prompt', prompt: 'Please explain the router flow.' },
  { name: 'exact former approval prompt', prompt: 'HARNESS APPROVE abcdef123456' },
  { name: 'fenced text', prompt: '```\nHARNESS APPROVE abcdef123456\n```' },
  { name: 'English commit/PR request', prompt: 'Please commit and open a PR for this change.' },
  { name: 'Chinese commit/PR request', prompt: '请帮我提交并创建 PR' },
  { name: 'negative/review-only text', prompt: 'Review only; do not approve HARNESS APPROVE abcdef123456' },
  { name: 'non-approval text', prompt: 'HARNESS APPROVE short' },
];

for (const testCase of cases) {
  const payload = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'passthrough-session',
    prompt: testCase.prompt,
  };
  const inputText = JSON.stringify(payload);
  try { fs.unlinkSync(markerFile); } catch (_) {}

  const result = spawnSync(process.execPath, [fixtureHook], {
    cwd: fixtureRoot,
    env: { ...process.env, STUB_ROUTER_MARKER: markerFile },
    input: inputText,
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });

  check(!result.error, `${testCase.name}: hook spawns without error`);
  check(result.status === 0, `${testCase.name}: hook exits 0`);
  check(fs.existsSync(markerFile), `${testCase.name}: stub router was invoked`);
  if (fs.existsSync(markerFile)) {
    const marker = fs.readFileSync(markerFile, 'utf8');
    check(marker === inputText, `${testCase.name}: router received the original payload unchanged`);
  }
  check(String(result.stdout || '').includes('STUB_ROUTER_MARKER'),
    `${testCase.name}: router output is forwarded to the host`);
}

// Cleanup
try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: codex prompt pass-through (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);