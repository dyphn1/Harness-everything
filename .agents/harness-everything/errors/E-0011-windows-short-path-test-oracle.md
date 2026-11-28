---
id: E-0011
signature: windows-short-path-test-oracle
class: test-coupling
title: "Tests built a temp path with fs.realpathSync and compared it with the product's canonical root, so Windows 8.3 short temp roots failed"
sites:
  - ci/mechanism-e1-dependency-artifact-scope.test.js
  - ci/mechanism-prb-outline-review.test.js
  - ci/fixtures/doc-obligations/reconciliation-s2a/harness.js
  - ci/mechanism-553-stop.test.js
violates: 'AGENTS.md: "CI runs Node.js 24 on Ubuntu/Windows/macOS"'
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 341-outline-windows-short-path
    feature: "#341 outline review roots"
    date: 2026-10-28
    closed: true
    rounds:
      - round: 0
        change: null
        review: unknown
        result: "Windows CI failure"
      - round: 1
        change: "Commit `c508e431`: outline roots built with `workflow-isolation` `canonical()`"
        review: "hosted CI at `c508e431`"
        result: "Windows self-regression and consistency still failed (cause not re-read)"
      - round: 2
        change: "Commit `f39f5333`: legacy session-dir keying on the raw workspace root"
        review: "hosted Windows CI green at `f39f5333` (#387 head, merged 2026-10-27)"
        result: "episode closed"
  - episode: 341-dependency-scope-windows-short-path
    feature: "#396 dependency-artifact inventory scope"
    date: 2026-11-07
    closed: true
    rounds:
      - round: 0
        change: null
        review: unknown
        result: "Windows self-regression: 12 assertion legs, expected `RUNNER~1` 8.3 short temp root vs the producer's canonical long root"
      - round: 1
        change: "Commit `8e597549`: fixture root via `canonical()`"
        review: "hosted Windows self-regression green at `2514056f`"
        result: "episode closed"
  - episode: 493-dispatch-cwd-short-path
    feature: "#468 dispatch CLI (PR #493)"
    date: 2026-11-20
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted Windows self-regression"
        result: "The dispatch test compared cwd strings and saw `RUNNER~1` vs `runneradmin`. The packet named E-0011, but the P2 fixture still compared raw strings."
      - round: 1
        change: "`3fbff51f` canonicalized Windows paths in the tests"
        review: "hosted Windows self-regression green"
        result: "episode closed"
  - episode: 553-stop-stderr-normaliser-windows
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-28
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted Windows CI on PR #556"
        result: "Packet T2-S's new stderr normaliser in `ci/mechanism-553-stop.test.js` used `/` separators and no 8.3 canonicalisation, so Windows hosted CI went red."
      - round: 1
        change: "WINfix packet, commit `a658af63`: normalise Windows session paths in the write-failure assertion"
        review: "hosted CI"
        result: "Windows green on hosted CI"
---

## Cue

A test compares a path built from `os.tmpdir()` or `fs.realpathSync` with a path the product canonicalized.

## What happened

Two episodes hit the same mismatch on Windows CI. The product canonicalized its roots with `workflow-isolation` `canonical()`, but the test fixtures built their roots with `fs.realpathSync`, which does not expand Windows 8.3 short names such as `RUNNER~1`. The first fix (`c508e431`) covered the outline roots. The #396 self-regression (12 assertion legs) was fixed in `8e597549`.

## Lesson

Build fixture roots with the same canonicalizer the product uses (`workflow-isolation` `canonical()`). `fs.realpathSync` does not expand Windows 8.3 names; `fs.realpathSync.native` does.

The shared `makeRepo` in `ci/fixtures/doc-obligations/reconciliation-s2a/harness.js` still uses `fs.realpathSync`. It was not changed because the other suites pass.

## Evidence

- `341-outline-windows-short-path` (2026-10-28): fix `c508e431`.
- #396: fix `8e597549`; hosted Windows self-regression green at `2514056f`.
- PR #493 (2026-11-20): raw cwd comparison despite the packet naming E-0011; fixed in `3fbff51f`.
- #553 (2026-11-28, PR #556): the T2-S stderr normaliser in `ci/mechanism-553-stop.test.js` used `/` separators and no 8.3 canonicalisation; Windows hosted CI went red. Fixed in `a658af63` (WINfix); Windows green on hosted CI. Re-violation of this record's canonicaliser lesson.
