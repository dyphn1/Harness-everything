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
---

## Cue

A guard or producer for a live path passes its deterministic tests and an independent review, then fails on the first real host run.

## Lesson

The deterministic positive for a live-path feature loads a real artifact from the shipped path: a task pin from `workflow-disposition.js plan/start`, a real `workflow-obligations.json`, real checker stdout. Reviewers should ask which inputs are real. Hand-built objects omit fields (absolute roots, binding paths) that the real host always carries.

## Evidence

- #341, PR #393 review findings; live runs 12-13 of the row-17 kit.
- #396 reviews review-6 and review-7; D8 fix `3732b134`; clean-checkout acceptance `59037db8` (coordinator-reported, not rerun by the reviewer).

A second shape of the same class: a fixture that borrows real artifacts from the developer's own checkout is not self-contained. It passes where those artifacts happen to exist and fails in a clean root or CI. Generate incidental install outputs inside the fixture; declared, installed devDependency code may be an explicit fixture input.

## Known limit (out of scope)

- The fixture still copies package files from the declared, installed `husky` devDependency (`node_modules/husky`). Review-7 records that the additional package-isolation demand was adjudicated out of scope. The error class stays `scope: in`.
