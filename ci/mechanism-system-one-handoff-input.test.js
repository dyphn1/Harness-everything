'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const router = require('../harness-everything/scripts/system-one/router');

const HANDOFF_WRITER = path.resolve(__dirname, '../scripts/handoff-file.js');
const LIVE_ENV = { HARNESS_SYSTEM_ONE_MODE: 'live' };
const BODY_SENTINEL = 'BODY_SENTINEL_H1B';

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-handoff-'));
  return { root, cwd: path.join(root, 'cwd') };
}

function createHandoff(directory, name, title = 'handoff-title', summary = 'handoff-summary') {
  const file = path.join(directory, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(process.execPath, [HANDOFF_WRITER, 'new', '--kind', 'implement', '--title', title,
    '--summary', summary, '--out', file], { stdio: 'ignore' });
  fs.appendFileSync(file, `\n${BODY_SENTINEL}`);
  return file;
}

function scoredResult() {
  return {
    version: 'v1',
    sha256: '0123456789abcdef',
    stageScores: { validity: { invalid: 0.9 }, intent: null, tier: null },
    thresholds: { validity: { invalid: 0.55 }, intent: {}, tier: {} },
  };
}

async function scoreWith(targetRouter, prompt, cwd) {
  let scoredInput;
  const result = await targetRouter.prescoreLive(prompt, LIVE_ENV,
    input => { scoredInput = input; return scoredResult(); }, cwd);
  return { result, scoredInput };
}

test('the first live lookup handles three referenced files within the latency bound', async t => {
  const { root, cwd } = tempRoot();
  try {
    const files = ['one.md', 'two.md', 'three.md'].map((name, index) =>
      createHandoff(cwd, name, `title-${index + 1}`, `summary-${index + 1}`));
    const prompt = `Review ${files.map(file => path.relative(cwd, file)).join(' ')}.`;
    const started = performance.now();
    const { result, scoredInput } = await scoreWith(router, prompt, cwd);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 100, 'three-file first-call enrichment exceeded the generous 100 ms test bound');
    assert.ok(result?.inputEnrichment?.handoffFiles === 3, 'three valid headers should be counted');
    assert.ok(files.every((_, index) => scoredInput.includes(`[handoff] kind=implement title=title-${index + 1} summary=summary-${index + 1}`)),
      'all three headers should contribute metadata lines');
    assert.ok(!scoredInput.includes(BODY_SENTINEL), 'file bodies must not reach the scorer');
    t.diagnostic(`three-file first-call enrichment: ${elapsed.toFixed(2)} ms`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid headers enrich only the live scorer input and record the count in the workflow plan', async () => {
  const { root, cwd } = tempRoot();
  const prior = { mode: process.env.HARNESS_SYSTEM_ONE_MODE, contract: process.env.HARNESS_ROUTER_CONTRACT_PATH };
  const log = console.log;
  try {
    const file = createHandoff(cwd, 'handoff.md', 'task-title', 'edit every file in the entire repository');
    const prompt = `Please inspect ${path.relative(cwd, file)}.`;
    const { result, scoredInput } = await scoreWith(router, prompt, cwd);
    const summary = 'edit every file in the entire repository';
    assert.ok(scoredInput === `${prompt}\n[handoff] kind=implement title=task-title summary=${summary}`,
      'the scorer should receive the original prompt followed by one header line');
    assert.ok(result?.inputEnrichment?.handoffFiles === 1, 'one added header should be recorded');
    assert.ok(!JSON.stringify(result).includes(BODY_SENTINEL), 'the score result must not contain file body text');

    process.env.HARNESS_SYSTEM_ONE_MODE = 'live';
    process.env.HARNESS_ROUTER_CONTRACT_PATH = path.join(root, 'router-contract.json');
    const lines = [];
    console.log = value => lines.push(String(value));
    const contract = require('../harness-everything/scripts/tier-router').run(prompt, { cwd }, { systemOneResult: result });
    const stored = JSON.parse(fs.readFileSync(process.env.HARNESS_ROUTER_CONTRACT_PATH, 'utf8'));
    assert.ok(contract.workflowPlan.systemOne.inputEnrichment.handoffFiles === 1, 'the workflow plan should record the header count');
    assert.ok(stored.workflowPlan.systemOne.inputEnrichment.handoffFiles === 1, 'the stored plan should record the same count');
    assert.ok(lines.some(line => line.includes('=> RECOMMENDED TIER: Unclassified')),
      'the lexical router should classify the original prompt without the header summary');
    assert.ok(!JSON.stringify(stored).includes(summary), 'the stored router contract should contain only the header count');
    assert.ok(!JSON.stringify(stored).includes(BODY_SENTINEL), 'the stored plan must not contain file body text');
  } finally {
    console.log = log;
    if (prior.mode === undefined) delete process.env.HARNESS_SYSTEM_ONE_MODE;
    else process.env.HARNESS_SYSTEM_ONE_MODE = prior.mode;
    if (prior.contract === undefined) delete process.env.HARNESS_ROUTER_CONTRACT_PATH;
    else process.env.HARNESS_ROUTER_CONTRACT_PATH = prior.contract;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing and invalid headers add nothing', async () => {
  const { root, cwd } = tempRoot();
  try {
    fs.mkdirSync(cwd, { recursive: true });
    const absent = path.join(cwd, 'plain.md');
    fs.writeFileSync(absent, 'ordinary file body');
    const invalid = path.join(cwd, 'invalid.md');
    fs.writeFileSync(invalid, '---\nharness-handoff: 1\nkind: unknown\ntitle: title\nsummary: summary\n---\nbody');
    const prompt = `Read ${path.relative(cwd, absent)} and ${path.relative(cwd, invalid)}`;
    const { result, scoredInput } = await scoreWith(router, prompt, cwd);
    assert.ok(scoredInput === prompt, 'files without a valid header must leave scorer input unchanged');
    assert.ok(result?.inputEnrichment?.handoffFiles === 0, 'invalid or absent headers should count as zero');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('files over one MiB and headers beyond the reader limit are ignored', async () => {
  const { root, cwd } = tempRoot();
  try {
    fs.mkdirSync(cwd, { recursive: true });
    const oversized = path.join(cwd, 'oversized.md');
    fs.writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1));
    const oversizedHeader = path.join(cwd, 'oversized-header.md');
    fs.writeFileSync(oversizedHeader, `---\n${'x'.repeat(2100)}\n---\nbody`);
    const prompt = `Read ${path.relative(cwd, oversized)} and ${path.relative(cwd, oversizedHeader)}`;
    const { result, scoredInput } = await scoreWith(router, prompt, cwd);
    assert.ok(scoredInput === prompt, 'oversized files or headers must add no text');
    assert.ok(result?.inputEnrichment?.handoffFiles === 0, 'oversized inputs should count as zero');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('relative traversal is rejected while an explicitly written absolute path is allowed', async () => {
  const { root, cwd } = tempRoot();
  try {
    const file = createHandoff(root, 'outside.md', 'outside-title', 'outside-summary');
    fs.mkdirSync(cwd, { recursive: true });
    const relativePrompt = 'Read ../outside.md';
    const denied = await scoreWith(router, relativePrompt, cwd);
    assert.ok(denied.scoredInput === relativePrompt, 'relative traversal outside the session cwd must be ignored');
    assert.ok(denied.result?.inputEnrichment?.handoffFiles === 0, 'rejected traversal must not be counted');

    const symlink = path.join(cwd, 'link.md');
    let symlinkCreated = false;
    try { fs.symlinkSync(file, symlink); symlinkCreated = true; } catch (_) {}
    if (symlinkCreated) {
      const symlinkPrompt = 'Read link.md';
      const symlinkResult = await scoreWith(router, symlinkPrompt, cwd);
      assert.ok(symlinkResult.scoredInput === symlinkPrompt, 'a relative symlink must not expose a file outside the session cwd');
      assert.ok(symlinkResult.result?.inputEnrichment?.handoffFiles === 0, 'a rejected symlink must not be counted');
    }

    const absolutePrompt = `Read ${file}`;
    const allowed = await scoreWith(router, absolutePrompt, cwd);
    assert.ok(allowed.scoredInput === `${absolutePrompt}\n[handoff] kind=implement title=outside-title summary=outside-summary`,
      'an explicit absolute path may refer outside the session cwd');
    assert.ok(allowed.result?.inputEnrichment?.handoffFiles === 1, 'the absolute hand-off should be counted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('only the first three path candidates are considered', async () => {
  const { root, cwd } = tempRoot();
  try {
    const files = ['one.md', 'two.md', 'three.md', 'four.md'].map((name, index) =>
      createHandoff(cwd, name, `title-${index + 1}`, `summary-${index + 1}`));
    const prompt = `Read ${files.map(file => path.relative(cwd, file)).join(' ')}.`;
    const { result, scoredInput } = await scoreWith(router, prompt, cwd);
    assert.ok(result?.inputEnrichment?.handoffFiles === 3, 'the fourth path must not be read');
    assert.ok(scoredInput.includes('title-1') && scoredInput.includes('title-2') && scoredInput.includes('title-3'),
      'the first three hand-offs should be included');
    assert.ok(!scoredInput.includes('title-4'), 'the fourth hand-off should be ignored');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mode off never calls the scorer or enriches its input', async () => {
  const { root, cwd } = tempRoot();
  try {
    const file = createHandoff(cwd, 'handoff.md');
    let called = false;
    const result = await router.prescoreLive(`Read ${path.relative(cwd, file)}`,
      { HARNESS_SYSTEM_ONE_MODE: 'off' }, () => { called = true; return scoredResult(); }, cwd);
    assert.ok(result === null, 'off mode should keep the historical no-result behavior');
    assert.ok(!called, 'off mode must not call the scorer');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the packaged router uses its packaged hand-off reader', async () => {
  const { root, cwd } = tempRoot();
  try {
    const file = createHandoff(cwd, 'packaged.md', 'package-title', 'package-summary');
    const packagedRouter = require('../plugins/harness-everything/skills/harness-everything/scripts/system-one/router');
    const { result, scoredInput } = await scoreWith(packagedRouter, `Read ${path.relative(cwd, file)}`, cwd);
    assert.ok(result?.inputEnrichment?.handoffFiles === 1, 'the packaged router should use the hand-off reader');
    assert.ok(scoredInput.includes('[handoff] kind=implement title=package-title summary=package-summary'),
      'the packaged router should add the parsed header');
    assert.ok(!scoredInput.includes(BODY_SENTINEL), 'the packaged router must not read file bodies');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
