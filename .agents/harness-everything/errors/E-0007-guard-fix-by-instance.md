---
id: E-0007
signature: guard-fix-by-instance-not-class
class: fix-loop
title: "A false-positive guard was fixed one field at a time instead of by predicate class"
sites:
  - hooks/scripts/lib/doc-reconciliation-producer.js
violates: "Advisor answer 18 section 1: \"an explicit task/requirement input intersecting it blocks the exclusion\" (only genuine inputs, not identity metadata, may block)"
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
---

## Cue

A guard produces a false positive on real input and the fix names the one field that tripped it.

## Lesson

Before writing the fix, replay the guard over the complete real live input and list every hit; fix the predicate that misclassifies the whole class, and put that real input in the test fixture. Re-check that the class fix does not open the opposite hole (here: wildcard syntax after relativizing).

## Evidence

- #341; live runs 12-14 of the row-17 kit; review finding on the absolute `?` selector.
