'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'harness-everything');
const listing = JSON.parse(fs.readFileSync(path.join(ROOT, 'submission', 'openai', 'listing.json'), 'utf8'));
const tests = JSON.parse(fs.readFileSync(path.join(ROOT, 'submission', 'openai', 'test-cases.json'), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));

function filesUnder(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

assert.strictEqual(listing.submission_type, 'skills_only');
assert.strictEqual(listing.plugin_name, plugin.interface.displayName);
assert.strictEqual(listing.short_description, plugin.interface.shortDescription);
assert.strictEqual(listing.long_description, plugin.interface.longDescription);
assert.strictEqual(listing.category, plugin.interface.category);
assert.strictEqual(listing.website_url, plugin.interface.websiteURL);
assert.strictEqual(listing.privacy_policy_url, plugin.interface.privacyPolicyURL);
assert.strictEqual(listing.terms_url, plugin.interface.termsOfServiceURL);
assert.deepStrictEqual(listing.starter_prompts, plugin.interface.defaultPrompt);
assert.match(listing.support_url, /^https:\/\/github\.com\/dyphn1\/Harness-everything\/blob\/main\/SUPPORT\.md$/);
assert.ok(fs.existsSync(path.join(ROOT, 'SUPPORT.md')), 'public support page is missing');
assert.ok(listing.release_notes && listing.release_notes.length >= 40, 'release notes are too thin for review');
assert.ok(listing.manual_requirements?.developer_identity, 'developer identity reminder missing');
assert.ok(listing.manual_requirements?.logo, 'logo upload reminder missing');
assert.ok(listing.manual_requirements?.apps_management_write_access, 'Apps Management access reminder missing');

assert.strictEqual(tests.positive.length, 5, 'OpenAI submission requires five positive test cases');
assert.strictEqual(tests.negative.length, 3, 'OpenAI submission requires three negative test cases');
const ids = new Set();
for (const test of tests.positive) {
  assert.ok(test.id && !ids.has(test.id), `duplicate/missing test id: ${test.id}`);
  ids.add(test.id);
  assert.ok(test.user_prompt?.trim(), `${test.id}: user_prompt missing`);
  assert.ok(test.expected_behavior?.trim(), `${test.id}: expected_behavior missing`);
  assert.ok(test.expected_result_shape?.trim(), `${test.id}: expected_result_shape missing`);
  assert.ok(test.fixture_data?.trim(), `${test.id}: fixture_data missing`);
}
for (const test of tests.negative) {
  assert.ok(test.id && !ids.has(test.id), `duplicate/missing test id: ${test.id}`);
  ids.add(test.id);
  assert.ok(test.user_prompt?.trim(), `${test.id}: user_prompt missing`);
  assert.ok(test.expected_behavior?.trim(), `${test.id}: expected_behavior missing`);
  assert.ok(test.reason_not_to_complete?.trim(), `${test.id}: reason_not_to_complete missing`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-openai-submission-'));
try {
  const first = path.join(tmp, 'first.zip');
  const second = path.join(tmp, 'second.zip');
  for (const output of [first, second]) {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-openai-submission.js'), '--output', output], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.strictEqual(run.status, 0, run.stderr || run.stdout);
    assert.ok(fs.existsSync(output), `bundle not produced: ${output}`);
  }
  assert.strictEqual(sha256(first), sha256(second), 'submission bundle must be deterministic');

  const manifest = JSON.parse(fs.readFileSync(first.replace(/\.zip$/, '.manifest.json'), 'utf8'));
  const expectedFiles = filesUnder(path.join(PLUGIN, 'skills')).map(file => `skills/${file}`);
  assert.deepStrictEqual(manifest.files.map(file => file.path), expectedFiles, 'bundle manifest must contain exactly packaged skill files');
  assert.strictEqual(manifest.file_count, expectedFiles.length);
  assert.strictEqual(manifest.bundle_sha256, sha256(first));

  const zip = fs.readFileSync(first);
  assert.strictEqual(zip.readUInt32LE(0), 0x04034b50, 'bundle must start with ZIP local-file signature');
  assert.strictEqual(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'bundle must end with ZIP EOCD signature');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('OpenAI public submission verified: listing metadata, 5+3 review cases, and deterministic skills bundle.');
