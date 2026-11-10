'use strict';

// Regression guard for packet 415: CHANGELOG.md must contain exactly one
// `## [Unreleased]` heading. Stray duplicate blocks reopen release-note
// ambiguity; this gate fails the release chain if one reappears.

const assert = require('assert');
const fs = require('fs');

function countUnreleasedHeadings(text) {
  return text.split('\n').filter((line) => /^## \[Unreleased\]\s*$/.test(line)).length;
}

const changelog = fs.readFileSync(require('path').join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
assert.strictEqual(countUnreleasedHeadings(changelog), 1);

// Negative control over the same counting function: two headings must report 2.
assert.strictEqual(
  countUnreleasedHeadings('## [Unreleased]\n\n* entry\n\n## [1.0.0] (2026-01-01)\n\n## [Unreleased]\n'),
  2
);
assert.strictEqual(countUnreleasedHeadings('## [1.0.0] (2026-01-01)\n'), 0);

console.log('PASS changelog-unreleased');
