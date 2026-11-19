'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const skill = fs.readFileSync(path.join(ROOT, 'fable-mode/SKILL.md'), 'utf8');
const packagedSkill = fs.readFileSync(path.join(ROOT, 'plugins/harness-everything/skills/fable-mode/SKILL.md'), 'utf8');
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

const workflow = skill.split('## Workflow\n')[1];
assert.strictEqual(packagedSkill, skill, 'OpenAI package includes the canonical Fable workflow');
const routing = [
  '## USE FOR:',
  '- Large multi-file, multi-source, or multi-session work',
  '- Fable profile explanations or explicit Fable execution requests',
  '- Work needing named delegation and cold verification',
  '',
  '## DO NOT USE FOR:',
  '- One obvious single-pass edit',
  '- Ordinary Tier 2 implementation or bugfix work',
  '',
  '## Select Operation First',
].join('\n');
assert.ok(skill.includes(routing), 'the existing Fable routing text is preserved');
assert.match(workflow, /^1\. Discover the runtime and lock the authorized file scope before edits\.$/m);
assert.ok(skill.includes('Execution only: stage checklist and audit records.'));
assert.match(skill, /Execution: `<this-skill-dir>\/scripts\/model-selector\.js`, stage contracts, and `<skills-repo-root>\/harness-everything\/scripts\/verify-gate\.js`\./);
assert.ok(skill.includes('For explanation/profile-only lookup, read only `<this-skill-dir>/references/profile-lookup.md` and answer. No stage state, delegation, or selector source reads. Quoted aliases do not start Fable. Mixed execution retains its topology; execution follows the workflow below.'));
assert.match(workflow, /^4\. Delegate by profile: orchestrator coordinates, reasoning takes bounded judgment, mechanical takes low-ambiguity work; workers never spawn workers\./m);
assert.match(workflow, /^5\. The host runtime-model floor is advisory; record it, never block on model choice alone\.$/m);
assert.match(workflow, /^6\. .*Run stage checks, cold-review high-stakes artifacts, and audit profile\/runtime\/fallback fields\.$/m);
const handoffReference = '`<this-skill-dir>/references/execution-phases.md#verification-and-handoff`'; // portability-lint: allow markdown text to match, never a path
assert.ok(workflow.includes(`4. Delegate by profile: orchestrator coordinates, reasoning takes bounded judgment, mechanical takes low-ambiguity work; workers never spawn workers. Before Codex dispatch, load/apply ${handoffReference}.`),
  'step 4 requires loading and applying the verification-and-handoff reference before Codex subagent dispatch');
assert.ok(workflow.includes(`6. On every Codex handoff or silent stop, load/apply ${handoffReference} before accepting results or releasing dependent stages. Run stage checks, cold-review high-stakes artifacts, and audit profile/runtime/fallback fields.`),
  'step 6 requires loading and applying the verification-and-handoff reference at every handoff before accepting results or releasing dependent stages');
assert.match(workflow, /^2\. Plan via `<this-skill-dir>\/references\/execution-phases\.md`\.$/m);
assert.match(workflow, /^3\. Use `model-selector\.js`\.$/m);
assert.match(guide, /^## Verification and handoff$/m, 'the explicit handoff target heading exists');
const handoff = guide.split(/\r?\n## Verification and handoff\r?\n/)[1];
assert.ok(handoff, 'the dispatch reference contains Verification and handoff');
assert.match(handoff, /coordinator MUST reconcile scope before accepting a\nresult or using it in a dependent stage/);
assert.match(handoff, /Before dispatch, capture the worker worktree's starting state/);
assert.match(handoff, /Run this check after every handoff, including silent stops\./);

console.log('PASS Fable execution phases match the active workflow contract and preserve a scoped legacy fallback');
