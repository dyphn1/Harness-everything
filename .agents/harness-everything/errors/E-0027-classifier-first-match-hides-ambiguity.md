---
id: E-0027
signature: classifier-first-match-hides-ambiguity
class: split-decision
title: "A diagnostic classifier took the first allow-list match, so ambiguous input got a definite outcome"
sites:
  - scripts/dispatch.js
  - ci/mechanism-468-dispatch-cli.test.js
  - docs/error-handling/details/c8-dispatch-cli.md
violates: "C8 Level 3 contract: missing/ambiguous diagnostics return 12 / NOT_READY"
scope: in
status: open
mechanism_ref: ci/mechanism-468-dispatch-cli.test.js
episodes:
  - episode: 493-readiness-diagnostic-order
    feature: "#468 dispatch CLI readiness classification (PR #493)"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: "owner review at 9a637d41 (P2)"
        result: "`readinessDiagnostic()` used `.find()` over the allow-list; stderr with both the rate-limit and the quota line returned 13 RUNNER_RATE_LIMITED only because that entry came first. Reordering the list would silently change the outcome."
      - round: 1
        change: "`7c102359` accepts a classification only when exactly one entry matches; a both-lines fixture row returns 12 NOT_READY"
        review: "mechanism test + hosted CI; owner merge"
        result: "episode closed"
---

## Cue

Code maps free-form output (stderr, logs) to one outcome through a list of patterns.

## What happened

The contract said ambiguous diagnostics mean NOT_READY, but the code returned the first match. Tests covered each single line, never two recognised lines together, so the list order became an undocumented decision.

## Lesson

- When several patterns can match, count the matches: exactly one → classify, zero or more than one → the contract's ambiguous outcome.
- Add a fixture row with two recognised signals; the outcome must not change when the list order changes.

## Evidence

- PR #493: owner review at `9a637d41`, fix `7c102359`.
