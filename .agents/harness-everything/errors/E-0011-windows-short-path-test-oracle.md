---
id: E-0011
signature: windows-short-path-test-oracle
class: test-coupling
title: "Tests built a temp path with fs.realpathSync and compared it with the product's canonical root, so Windows 8.3 short temp roots failed"
sites:
  - ci/mechanism-e1-dependency-artifact-scope.test.js
  - ci/mechanism-prb-outline-review.test.js
  - ci/fixtures/doc-obligations/reconciliation-s2a/harness.js
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
        review: unknown
        result: "unknown; the packet marks the episode closed"
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
