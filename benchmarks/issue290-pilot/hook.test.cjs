'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue290-hook-test-'));
const docs = ['fable-mode/SKILL.md', 'fable-mode/references/profile-lookup.md'];
const payload = {hook_event_name: 'UserPromptSubmit', session_id: 'issue290-mechanism', cwd: dir,
  prompt: "Explain what 'fable on sonnect' means; return only a small JSON selection record."};
for (const arm of ['A', 'B']) {
  fs.writeFileSync(path.join(dir, '.pilot.json'), JSON.stringify({source: root, arm, documents: docs,
    trace: path.join(dir, arm+'.jsonl'), routerTrace: path.join(dir, arm+'.router')}));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'host-hook.cjs')], {
    cwd: dir, input: JSON.stringify(payload), encoding: 'utf8',
    env: {...process.env, HARNESS_STATE_HOME: path.join(dir, '.state-'+arm)},
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'UserPromptSubmit');
  assert.match(out.additionalContext, /direct-single/);
  assert.match(fs.readFileSync(path.join(dir, arm+'.router'), 'utf8'), /profile-lookup/);
  if (arm === 'A') assert.match(out.additionalContext, /read every listed reference now/);
  else assert.doesNotMatch(out.additionalContext, /read every listed reference now/);
}
console.log('PASS canonical host-hook attribution and isolated A/B timing');
