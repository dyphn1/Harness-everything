---
id: E-0018
signature: machine-state-leaks-into-tests
class: test-isolation
title: "Tests read the developer's live System One store or inherited shell mode, so they pass in clean sandboxes and fail on the coordinator's machine"
sites:
  - ci/mechanism-system-one-cycle.test.js
  - scripts/system-one-cycle/collect.js
  - ci/router-workflow-plan.test.js
violates: unknown
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: s1-collect-live-store-leak
    feature: "#442 System One cycle collect imports live observations (commit aa8af525)"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "After aa8af525 made collect import the live observation store, the test 'collect preserves self-reported intents' read the real obs.storeRoot() on the coordinator's machine and got 107 !== 1. Worker sandboxes passed because no readable real store exists there."
      - round: 1
        change: "Commit f42da57b: the tests point the live store at a fixture"
        review: unknown
        result: "Fixed on the branch. No closing review is recorded, so the episode stays open."
  - episode: 449-shell-live-mode-inherited
    feature: "#449 routing invariant tests (local verify:all)"
    date: unknown
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "HARNESS_SYSTEM_ONE_MODE=live inherited from the shell made the routing invariant tests fail locally (false FAIL at ci/router-workflow-plan.test.js:169-171). Hosted CI was green. Open in #449."
---

## Cue

A test that depends on machine state (a real store under the home directory, an environment variable exported in the shell) passes in a clean CI or sandbox and fails on a developer's machine, or the reverse.

## What happened

Episode 1 (commit `aa8af525`, then `f42da57b`): the cycle collect tests read the real live observation store. On the coordinator's machine the count was 107 where the test expected 1. Worker sandboxes had no readable real store, so they passed.

Episode 2 (#449): routing invariant tests inherit `HARNESS_SYSTEM_ONE_MODE=live` from the shell. Local `verify:all` reports a false FAIL, while hosted CI, which starts with a clean environment, is green.

## Lesson

Every test that touches a store, an environment variable or a home-directory path must point it at a fixture it controls. A passing sandbox run does not prove a test is hermetic. Check the coordinator's local `verify:all` as well as hosted CI.

## Evidence

- `aa8af525` (collect imports the live store) and `f42da57b` (fixture isolation), both 2026-11-15.
- #449 (open): shell-inherited `HARNESS_SYSTEM_ONE_MODE`.
- Related: E-0011 (test path oracle on Windows) and E-0009 (sandbox limits). Neither covers machine state inside a test's own inputs.
