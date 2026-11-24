---
id: E-0035
signature: golden-test-fails-under-system-temp
class: test-coupling
title: "w-golden.byte-equivalence fails in any clone located under the system temp directory, even on an unchanged base"
sites:
  - "ci/mechanism-325-3b-s2b-wiring.test.js (w-golden.byte-equivalence@source/@packaged)"
violates: unknown
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 496-golden-byte-equivalence-temp-clone
    feature: "#496 packets D1 and B"
    date: 2026-11-24
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "`ci/mechanism-325-3b-s2b-wiring.test.js` (`w-golden.byte-equivalence@source/@packaged`) failed in worker clones located under the system temp directory (and reproduced on an unchanged base there), while passing in a worktree inside the repository and on main. Several worker reports listed it as a failure; the coordinator had to prove it environmental."
---

## Cue

`ci/mechanism-325-3b-s2b-wiring.test.js` reports `FAIL` on `w-golden.byte-equivalence@source/@packaged` inside a worker clone located under the system temp directory, when the packet did not touch the wiring or golden fixtures.

## What happened

During #496 (packets D1 and B), multiple worker reports listed `w-golden.byte-equivalence@source/@packaged` in `ci/mechanism-325-3b-s2b-wiring.test.js` as a failure. Running the test on an unchanged base proved it fails in any clone located under the system temp directory, while passing in a worktree inside the repository and on `main`. The coordinator had to run control checks to establish that the failure was environmental rather than a regression introduced by the packets.

## Lesson

- Before treating a `w-golden.byte-equivalence@source/@packaged` failure from a worker clone under the system temp directory as a product regression, check it on an unchanged base in the same location or in a worktree inside the repository.
- When fixing or stabilizing the wiring golden suite, eliminate checkout-location sensitivity so byte-equivalence holds regardless of whether the repository clone lives under the system temp directory.

## Evidence

- #496 packets D1 and B (2026-11-24).
- Related: E-0018 covers tests leaking developer machine state (home-directory stores, inherited shell env); E-0011 and E-0019 cover Windows temp-path assumptions. This record covers checkout-location sensitivity under the system temp directory.
