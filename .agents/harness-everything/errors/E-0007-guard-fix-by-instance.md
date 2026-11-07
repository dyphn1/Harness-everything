---
id: E-0007
signature: guard-fix-by-instance-not-class
class: fix-loop
title: "A dependency-exclusion overlap guard was fixed one field or spelling at a time instead of by predicate class, leaving false positives and wildcard false negatives"
sites:
  - hooks/scripts/lib/doc-reconciliation-producer.js
violates: "Advisor answer 18 section 1: \"an explicit task/requirement input intersecting it blocks the exclusion\" (only genuine inputs, not identity metadata, may block); and \"Broad/unknown selectors that may intersect are not evidence of disjointness.\" The record covers both false positives and false negatives in this input class."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 341-dependency-scope-task-input-overlap
    feature: "#341 stage 2 dependency-artifact inventory scope"
    date: 2026-10-29
    closed: false
    rounds:
      - round: 0
        change: null
        review: live-run
        result: "Live installed-tree run refused with `task-input-overlap`: the task pin's absolute baselineRoot matched as a selector"
      - round: 1
        change: "Excluded task-pin identity fields from the check"
        review: live-run
        result: "Next live run failed the same way on another absolute path (a resolved skill binding in requirements)"
      - round: 2
        change: "Absolute selectors resolved against the workspace: outside is disjoint, inside is relativized"
        review: live-run+independent
        result: "Live run FEASIBLE; independent review then found an absolute `?` wildcard selector now slips past the matcher (open)"
      - round: 3
        change: "Commit `3732b134`: initial wildcard class repair"
        review: review-5
        result: "Brace traversal still evades the guard"
      - round: 4
        change: "Commit `59037db8`: unsupported syntax and traversal repair"
        review: review-6
        result: "A repeated `./` wildcard spelling still evades the guard"
      - round: 5
        change: "Commit `2eb19883`: normalization repair"
        review: "review-7, then advisor adjudication (answer 21)"
        result: "Broad sweep found a mixed-case wildcard row that evaded the guard; first unresolved, then adjudicated in scope. Still open."
      - round: 6
        change: "Commit `b6aa96a3`: wildcard matching folds case like literal root mentions; RED to GREEN on a mixed-case matrix"
        review: unknown
        result: "pending review"
---

## Cue

A guard produces a false positive on real input and the fix names the one field that tripped it. Later, each repair closes one spelling (brace, `./`, mixed case) and a sibling spelling in the same class gets through.

## Lesson

Before writing the fix, replay the guard over the complete real live input and list every hit; fix the predicate that misclassifies the whole class, and put that real input in the test fixture. Enumerate the class (supported transformations plus unknown syntax) before the first fix, not one spelling per round. Re-check that the class fix does not open the opposite hole (here: wildcard syntax after relativizing).

## Status and promotion

- `closed: false`. Round 5 is still open; round 6 awaits independent review.
- Kept at `status: lesson`. The recorded lesson was re-violated across several rounds, so escalation to a mechanism is warranted, but `status: mechanism` requires an artifact that exists. None exists yet.
- **Proposed mechanism (not in place):** extend the "Counterexample categories covered" field in `code-review/templates/finding.template.md` into a required table: family, representative or equivalent spelling, expected result, actual result per implementation, and evidence tier or UNCHECKED. Reviewers derive the families from the scope anchor and enumerate supported transformations plus unknown syntax; uncovered families stay visible. Record the committed path or SHA as `mechanism_ref` after integration.
- The executable selector matrix in the dependency-scope test is the companion deterministic guard for this class. The review template is not CI-enforced.
- Do not read this as "converged in one round": review-7 found an unresolved boundary after the normalization repair, and no paired evidence shows the template speeds convergence.

## Evidence

- #341; live runs 12-14 of the row-17 kit; review finding on the absolute `?` selector.
- #396 reviews review-5, review-6 and review-7 (D7 sweeps); commits `3732b134`, `59037db8`, `2eb19883`, `b6aa96a3`; advisor adjudication (answer 21).
