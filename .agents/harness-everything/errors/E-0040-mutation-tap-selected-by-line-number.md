---
id: E-0040
signature: mutation-tap-selected-by-line-number
class: test-coupling
title: "A helper inserted above a legacy assertion moved the line that the mutation tap selects, so test:mutations failed only at the full gate"
sites:
  - ci/mechanism-35-verification-contract.test.js
  - "test:mutations (package.json script, ci/mutation-check.js)"
violates: "Verification includes the CI-equivalent gates (lint, portability, consistency, or the project's `verify:all --fast`), not only unit tests."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 553-mutation-tap-line-selector
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-28
    closed: true
    rounds:
      - round: 0
        change: null
        review: "G3 full gate"
        result: "Packet T2-S inserted helpers above a legacy assertion. The mutation tap selects that assertion by line, so `test:mutations` reported `verdict=CONTROL_FAILED` (expected one passing `LEGACY.mechanism-35-verification-contract/...authoritative-contract-precedence` event). The packet acceptance helper did not run `test:mutations`, so the failure surfaced only at G3."
      - round: 1
        change: "G3fix packet, commit `c79dd17c`: keep the mutation tap line stable after the F4 controls move"
        review: "mutation check"
        result: "`test:mutations` passes"
---

## Cue

A helper or assertion is inserted above a line that the mutation tap selects by line number, and the packet's acceptance runs unit tests but not `test:mutations`.

## What happened

On 2026-11-28 packet T2-S inserted helpers above a legacy assertion in `ci/mechanism-35-verification-contract.test.js`. The mutation tap selects that assertion by line, so the line moved and `test:mutations` reported `CONTROL_FAILED`. The packet acceptance helper did not run `test:mutations`, so the failure surfaced only at the G3 full gate. Commit `c79dd17c` ("test(verify): keep the mutation tap line stable after the f4 controls move") restored the tap line, and the mutation check passed.

## Lesson

When a touched suite is in the mutation registry, packet acceptance runs `npm run test:mutations`.

## Evidence

- PR #556 (#553 E1 runtime retirement): G3 full gate failure on 2026-11-28; fix commit `c79dd17c`, after which the mutation check passed.
