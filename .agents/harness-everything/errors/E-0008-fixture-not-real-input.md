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
    closed: false
    rounds:
      - round: 0
        change: null
        review: independent
        result: "Derived-regenerate test stopped at provider acceptance; review asked for the reconciliation assertion"
      - round: 1
        change: "Whole-seam test through pilot.assess"
        review: independent
        result: "Closed for derived; the dependency-scope consumer test then used a hand-built task pin, passed review, and missed the live `task-input-overlap` defect twice"
---

## Cue

A guard or producer for a live path passes its deterministic tests and an independent review, then fails on the first real host run.

## Lesson

The deterministic positive for a live-path feature loads a real artifact from the shipped path: a task pin from `workflow-disposition.js plan/start`, a real `workflow-obligations.json`, real checker stdout. Reviewers should ask which inputs are real. Hand-built objects omit fields (absolute roots, binding paths) that the real host always carries.

## Evidence

- #341, PR #393 review findings; live runs 12-13 of the row-17 kit.
