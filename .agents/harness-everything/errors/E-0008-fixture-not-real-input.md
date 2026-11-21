---
id: E-0008
signature: deterministic-fixture-not-real-input
class: test-coupling
title: "Deterministic tests for live-path features used hand-built inputs and missed real-host defects"
sites:
  - ci/mechanism-e1-derived-regenerate.test.js
  - ci/mechanism-e1-dependency-artifact-scope.test.js
violates: "Advisor answer 14 section 2: \"Assert that outcome, not only helper output or overall PASS.\""
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 341-e1-live-path-fixtures
    feature: "#341 E1 stage 1-2 repairs"
    date: 2026-10-29
    closed: true
    rounds:
      - round: 0
        change: null
        review: independent
        result: "Derived-regenerate test stopped at provider acceptance; review asked for the reconciliation assertion"
      - round: 1
        change: "Whole-seam test through pilot.assess"
        review: independent
        result: "Closed for derived; the dependency-scope consumer test then used a hand-built task pin, passed review, and missed the live `task-input-overlap` defect twice"
      - round: 2
        change: "Dependency-scope test copies installed artifacts from the host checkout as its witness"
        review: full-gate
        result: "Passed in the developer checkout and in the fast gate; failed every case with ENOENT in a clean verify root because `.husky/_` exists only where husky was installed locally"
      - round: 3
        change: "D8 fix, commit `3732b134`: the fixture generates its own `.husky/_` by running the copied Husky package in its own repository. Clean-checkout acceptance recorded at `59037db8` (coordinator-reported, normal and `HUSKY=0 CI=true`, checkout `.husky/_` absent)."
        review: "review-6, review-7"
        result: "Review-7 reports no D8 finding under the adjudicated scope. Its deferred list has only D7 (a selector item, recorded on E-0007) and D8, so no other fixture subissue remains open; episode closed. The package-copy prerequisite is an out-of-scope known limit, not an open defect."
  - episode: w3-heartbeat-sampling-oracle
    feature: unknown
    date: unknown
    closed: false
    rounds:
      - round: 0
        change: null
        review: "W3 RED run on correct code"
        result: "A cancellation test sampled heartbeat output after a fixed sleep and reported processStopped:false on correct code: a false RED from a timing-sampled proxy signal."
      - round: 1
        change: "Commit a8ef3d49 (test-only): prove cancellation via process exit instead of heartbeat sampling"
        review: unknown
        result: "Fixed on the branch. The false RED cost one diagnose round."
  - episode: 468-c8-runner-self-test-not-real-path
    feature: "#468 C8 one-shot runner template"
    date: 2026-11-18
    closed: false
    rounds:
      - round: 0
        change: null
        review: "first real dispatch"
        result: "The template's `--self-test` passed, but the first real dispatch exited 1 silently: `validate_inputs` ended in `is_inside_repo … && fail 11`, which returns 1 under `set -e` for a compliant scratch dir; the self-test never calls `validate_inputs`. Slice parked for the owner (#468)."
  - episode: 471-c7-worker-claim-not-reproducible
    feature: "PR #471 C7"
    date: 2026-11-18
    closed: true
    rounds:
      - round: 0
        change: null
        review: "coordinator re-run from the C2 worktree"
        result: "The C7 report said the pinned real-slice check passed; the coordinator re-ran it from the C2 worktree and got exit 1, because the checker inspected its own repository (`__dirname`) and that worktree's untracked files."
      - round: 1
        change: "C7b repair (bcf3c577): the check no longer depends on the checker's own repository or untracked files"
        review: "RC7"
        result: "RC7 found no blocker; episode closed 2026-11-18."
  - episode: 497-dispatch-readiness-live-shapes
    feature: "#497 dispatch CLI first real use (PR #499)"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: "live OpenCode dispatch"
        result: "readiness reply READY. (with period) returned 12 NOT_READY; fixtures only had READY."
      - round: 1
        change: "6e3bcc2f: accept READY or READY."
        review: "live OpenCode dispatch"
        result: "the reply also ended with a harness-label line (Harness turn-label rule) → NOT_READY again"
      - round: 2
        change: "b41a9662: drop one terminal label line; accept a blank line before the label in dispatch and the report writer"
        review: "live dispatch on OpenCode and Codex"
        result: "both runners 0 DONE; the codex -o output had a blank line before the label, also absent from fixtures"
      - round: 3
        change: "d0e91ef9: label object kept opaque in readiness (advisor answer 3)"
        review: "review RV + hosted CI"
        result: "merged as PR #499; episode closed"
---

## Cue

A guard or producer for a live path passes its deterministic tests and an independent review, then fails on the first real host run.

## Lesson

The deterministic positive for a live-path feature loads a real artifact from the shipped path: a task pin from `workflow-disposition.js plan/start`, a real `workflow-obligations.json`, real checker stdout. Reviewers should ask which inputs are real. Hand-built objects omit fields (absolute roots, binding paths) that the real host always carries.

Episode 3 adds: a self-test is not evidence for the real path unless it calls the same entry point the dispatch uses. A self-test that skips `validate_inputs` passes while the first real dispatch exits 1 silently under `set -e`.

Episode 4 adds: a worker's "the real-slice check passed" claim is not reproducible from a different worktree if the checker inspects its own repository (`__dirname`) and untracked files. The coordinator re-run from the C2 worktree is the check that counts, not the reporter's local success.

## Evidence

- #341, PR #393 review findings; live runs 12-13 of the row-17 kit.
- #396 reviews review-6 and review-7; D8 fix `3732b134`; clean-checkout acceptance `59037db8` (coordinator-reported, not rerun by the reviewer).

A second shape of the same class: a fixture that borrows real artifacts from the developer's own checkout is not self-contained. It passes where those artifacts happen to exist and fails in a clean root or CI. Generate incidental install outputs inside the fixture; declared, installed devDependency code may be an explicit fixture input.

## Episode 2 (W3 cancellation test)

A third shape: the oracle sampled a proxy signal — heartbeat output after a fixed sleep — and the sample disagreed with the real outcome, so correct code reported a false RED (`processStopped:false`). Assert the outcome itself: prove cancellation via process exit (fix `a8ef3d49`, test-only), not via a timing-dependent proxy. Cost: one diagnose round.

## Known limit (out of scope)

- The fixture still copies package files from the declared, installed `husky` devDependency (`node_modules/husky`). Review-7 records that the additional package-isolation demand was adjudicated out of scope. The error class stays `scope: in`.

## Episode 3 (2026-11-18, #468)

A one-shot runner template's `--self-test` passed while the first real dispatch exited 1 silently. `validate_inputs` ended in `is_inside_repo … && fail 11`, which returns 1 under `set -e` for a compliant scratch directory, and the self-test never called `validate_inputs`. Same class as the earlier fixture episodes: the deterministic check did not traverse the real path. The slice is parked for the owner in #468.

## Episode 4 (2026-11-18, PR #471 C7)

The C7 report said the pinned real-slice check passed. The coordinator re-ran it from the C2 worktree and got exit 1, because the checker inspected its own repository (`__dirname`) and that worktree's untracked files — a claim that held only in the reporter's own checkout. The C7b repair (`bcf3c577`) removed that dependence and RC7 found no blocker. This also touches E-0005 (a review claim that could not be reproduced from the evidence).
- PR #499: commits `6e3bcc2f`, `b41a9662`, `d0e91ef9`; three real host shapes found only by live runs.
