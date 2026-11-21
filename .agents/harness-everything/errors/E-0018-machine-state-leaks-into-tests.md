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
    date: 2026-11-18
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "HARNESS_SYSTEM_ONE_MODE=live inherited from the shell made the routing invariant tests fail locally (false FAIL at ci/router-workflow-plan.test.js:169-171), on the PR #462 head and on main. Hosted CI was green. Open in #449."
      - round: 1
        change: "C3 in PR #471 (42b0a45f): every routing child gets the mode from one env builder, plus an inherited-live regression and an explicit live control"
        review: "executed evidence: live, unset, off and unknown value; mutant 7 FAIL"
        result: "Closed on executed evidence 2026-11-18: the inherited-live case is a regression, the explicit live control passes and mutant 7 is detected."
  - episode: 493-alias-h-canonical-map
    feature: "#468 C8 map alias H (PR #493)"
    date: 2026-11-20
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Adding the C8 alias H to `docs/error-handling/nodes.yaml` failed the error-handling-map mechanism test, which hard-coded H as the unused alias: the oracle assumed the canonical map state of the day."
      - round: 1
        change: "The test fixture moved its new alias to `I` (PR #493); it still hard-codes the next free alias, so the next Action added to the map hits the same coupling"
        review: "mechanism test + verify:all --fast"
        result: "Green again; episode left open because the fixture still assumes the map state"
  - episode: 501-s2-asserts-packet-time-stale-index
    feature: "#394 packet S2 (PR #501)"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: "coordinator focused test after index regeneration"
        result: "the worker replaced the current-index regression control with an assertion that the committed index is stale — true only while the packet ran."
      - round: 1
        change: "4dc6f8f4: restored the current-index control"
        review: "verify:all"
        result: "pass; episode closed"
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
- #449 (closed by PR #471): shell-inherited `HARNESS_SYSTEM_ONE_MODE`; PR #462 head and main reproduced the local row-8 FAIL; C3 fix in PR #471 (`42b0a45f`).
- Related: E-0011 (test path oracle on Windows) and E-0009 (sandbox limits). Neither covers machine state inside a test's own inputs.

## Episode 2 closure (2026-11-18, #449 / PR #462 / PR #471)

The shell-inherited `HARNESS_SYSTEM_ONE_MODE=live` also failed local `verify:all` row 8 on the PR #462 head and on main, while hosted CI stayed green. C3 in PR #471 (`42b0a45f`) made every routing child take the mode from one env builder and added an inherited-live regression plus an explicit live control. Episode closed on executed evidence: live, unset, off and unknown value, with mutant 7 detected.
- PR #493 (2026-11-20): map test hard-coded the unused alias H.
- PR #501: `4dc6f8f4`.
