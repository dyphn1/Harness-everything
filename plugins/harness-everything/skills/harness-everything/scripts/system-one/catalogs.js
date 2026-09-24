'use strict';
// Fixed System One catalogs, one per stage (docs/system-one-routing.md#staged-classification).
// Option order is the scorer's output order; changing it invalidates trained weights.
const { TIER_OPTIONS } = require('./router');
const INTENT_OPTIONS = Object.freeze([
  { id: 'explain', text: 'Answer a question or explain how something works.' },
  { id: 'discuss', text: 'Weigh options, give an opinion or settle a decision.' },
  { id: 'git', text: 'Git or GitHub housekeeping: commit, push, branch, pull request.' },
  { id: 'fix', text: 'Repair wrong behavior: a bug, crash, failing test or build.' },
  { id: 'feature', text: 'Add new behavior: a command, option, format or script.' },
  { id: 'refactor', text: 'Restructure or unify existing code without new behavior.' },
  { id: 'review', text: 'Evaluate an existing artifact against a standard.' },
  { id: 'test', text: 'Run tests or builds, or write tests as the main deliverable.' },
  { id: 'docs', text: 'Write or edit documentation as the main deliverable.' },
  { id: 'plan', text: 'Produce a plan, specification or breakdown before implementation.' },
  { id: 'investigate', text: 'Find facts or a cause and report back without changing anything.' },
  { id: 'unclassified', text: 'Unclear intent, insufficient context or outside these categories.' },
].map(Object.freeze));
const CATALOGS = Object.freeze({ tier: TIER_OPTIONS, intent: INTENT_OPTIONS });
// Gold labels of a stage: its catalog ids, with the abstaining option recorded as null.
function goldLabels(task) {
  if (!Object.hasOwn(CATALOGS, task)) throw new TypeError('unknown-task');
  return CATALOGS[task].map(o => (o.id === 'unclassified' ? null : o.id));
}
module.exports = { INTENT_OPTIONS, CATALOGS, goldLabels };
