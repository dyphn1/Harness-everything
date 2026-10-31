'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const guide = fs.readFileSync(path.join(ROOT, 'fable-mode/references/execution-phases.md'), 'utf8');
const packagedGuide = fs.readFileSync(path.join(ROOT, 'plugins/harness-everything/skills/fable-mode/references/execution-phases.md'), 'utf8');
const contract = fs.readFileSync(path.join(ROOT, 'fable-mode/CONTRACT-FORMAT.md'), 'utf8');
const activeStart = guide.indexOf('## Active workflow');
const recoveryStart = guide.indexOf('## Blocked recovery');
const legacyStart = guide.indexOf('## Legacy/manual fallback');
const active = guide.slice(activeStart, recoveryStart);
const legacyPath = '.claude/harness-everything/state/contracts/';

assert.strictEqual(packagedGuide, guide, 'OpenAI package includes the canonical execution phases reference');
assert.ok(activeStart >= 0 && recoveryStart > activeStart, 'active workflow and blocked recovery are explicit sections');
assert.ok(legacyStart > recoveryStart, 'legacy instructions are isolated after current recovery guidance');
assert.match(active, /workflow-stages\.json/);
assert.match(active, /workflow-disposition\.js.*start/s);
assert.match(active, /stage-binding.*--session-id.*--stage-id.*--binding-id.*--disposition.*--evidence/s);
assert.match(active, /contract-test\.js/);
assert.match(active, /worker identity/i);
assert.match(active, /exit code/i);
assert.match(active, /semantic MUSTs/i);
assert.match(active, /reminder-only/i);
assert.match(active, /without locking\s+ordinary tools or Stop/i);
assert.ok(!active.includes(legacyPath), 'active workflows never use the legacy contracts path');
assert.match(contract, /workflow-stages\.json/);
assert.match(contract, /stage results need observed worker identities and numeric exit codes/i);

const recovery = guide.slice(recoveryStart, legacyStart);
assert.match(recovery, /workflow already running; record a blocker before replanning/);
assert.match(recovery, /workflow-disposition\.js.*block/s);
assert.match(recovery, /workflow-stages\.json/);
assert.match(recovery, /workflow-disposition\.js.*start/s);
assert.match(recovery, /retaining|preserving/i);
assert.match(recovery, /plan.*blocked|blocked.*plan/s);

assert.match(guide, /behavior profile|role\/profile alias/i);
assert.match(guide, /explicit user or\s+host runtime choice/i);
assert.doesNotMatch(guide, /Resolve requested model|Opus macro work|do not silently change models/i);
assert.match(guide.slice(legacyStart), /`\.claude\/harness-everything\/state\/contracts\//);

console.log('PASS Fable execution phases match the active workflow contract and preserve a scoped legacy fallback');
