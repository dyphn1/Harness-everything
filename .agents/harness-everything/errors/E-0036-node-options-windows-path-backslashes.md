---
id: E-0036
signature: node-options-windows-path-backslashes
class: test-coupling
title: "A test passed a native Windows temp path through NODE_OPTIONS --require; Node consumed the backslashes and Windows self-regression could not load the preload"
sites:
  - "tests that pass a temp preload path through NODE_OPTIONS=--require"
  - ci/mechanism-325-f3-derived-views.test.js
  - "PR #531 lock-injection test (commit 78e851a9)"
violates: 'AGENTS.md: "CI runs Node.js 24 on Ubuntu/Windows/macOS"'
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 531-node-options-windows-preload-path
    feature: "PR #531 lock-injection test"
    date: 2026-11-25
    closed: false
    rounds:
      - round: 0
        change: null
        review: "hosted Windows self-regression"
        result: "The new test passed `NODE_OPTIONS=--require=<temp path>` with a native Windows path. Node's NODE_OPTIONS parsing dropped the backslashes, so the run failed with `Cannot find module 'C:Usersrunneradmin...lock-injection.js'`; macOS and Linux passed."
      - round: 1
        change: "Commit `78e851a9`: convert the preload path to forward slashes, the form already used in `ci/mechanism-325-f3-derived-views.test.js`."
        review: unknown
        result: "Fixed on the branch. No closing review is recorded, so the episode stays open."
---

## Cue

A test embeds a temp-file path in `NODE_OPTIONS=--require=...`, and the value is a native Windows path with backslashes.

## What happened

On PR #531 a new test passed a native Windows temp path through `NODE_OPTIONS=--require`. Node tokenizes NODE_OPTIONS values and consumed the backslashes, so the module path arrived as `C:Usersrunneradmin...lock-injection.js` and Windows `self-regression` could not load the preload. macOS and Linux passed with the same test. The fix was the forward-slash path form already present in `ci/mechanism-325-f3-derived-views.test.js` (`preload.replace(/\\/g, '/')`). The packet that introduced the test did not name this lesson.

## Lesson

Use forward slashes for any path embedded in `NODE_OPTIONS`, or pass the preload as a real argv element to `node --require <path>` instead of through `NODE_OPTIONS`. A packet that adds a test loading a preload through `NODE_OPTIONS` states the slash form up front and names this record next to the Windows path records.

## Evidence

- PR #531, fix commit `78e851a9`; existing forward-slash form in `ci/mechanism-325-f3-derived-views.test.js`.
- `ci/mechanism-325-3b-s1-review.test.js` records the related NODE_OPTIONS space-tokenization hazard and uses argv elements instead.
- Related but distinct: E-0011 (Windows 8.3 short names from `fs.realpathSync`) and E-0019 (cross-drive `path.relative`). Neither covers backslash consumption in NODE_OPTIONS.
