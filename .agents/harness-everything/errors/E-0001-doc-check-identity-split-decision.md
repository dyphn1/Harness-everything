---
id: E-0001
signature: doc-check-identity-split-decision
class: split-decision
title: "\"Is this the trusted doc-check?\" was decided independently at several sites"
sites:
  - hooks/scripts/lib/doc-reconciliation-pilot.js
  - hooks/scripts/lib/doc-reconciliation-provider.js
violates: "#325 H3: claims alone, unavailable observations, stale bindings, unsupported waivers and contradictory runs cannot become a false PASS."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 325-f4-checker-identity
    feature: "#325 F4 credited reconciliation (PR #358)"
    date: 2026-10-22
    closed: false
    rounds:
      - round: 0
        change: null
        review: "Adversarial review of F4"
        result: "P1: a self-authored script printing passing doc-check JSON earned credit"
      - round: 1
        change: "Installed-path identity plus shipped digest pin"
        review: "Re-review at bb23ea1"
        result: "New same-class P2: a case-variant invocation of the installed check was dropped from capture; the parser and candidate filter decided identity differently"
      - round: 2
        change: "One identity resolver (invariant I1), committed as 0308386"
        review: unknown
        result: "Closing invariant review not yet run"
  - episode: 325-f4-l3-candidate-overcapture
    feature: "#325 F4 normal-session credit (PR #358), input 0308386"
    date: 2026-10-23
    closed: false
    rounds:
      - round: 0
        change: null
        review: "Live no-credit discovery and read-only diagnosis at 0308386; advisor accepts candidate-boundary finding"
        result: "Plan JSON mentioning doc-check projected as two stale refs; valid checker accepted but credit withheld. Corrected-review replay still withholds; current-check-only control is eligible. Fix and closing review unknown."
---

## Cue

Two or more review rounds in a row each find a new defect in the same acceptance decision, here whether a command is the trusted doc-check, while every command succeeds.

## What happened

The parser, the capture candidate filter, the installed-path check and the digest check each answered "is this the trusted checker?" on their own. Each fix closed one site, and the next review found another site deciding differently. Nine F4 fix rounds ran before anyone classified the findings.

## Lesson

Stop point-fixing after the second same-class round. List the findings by decision class, name the violated clause, inventory every site that makes the decision (including unchanged consumers), then choose the smallest justified correction and re-trace one normal acceptance path. See the zoom-out repair-loop trigger.

## Evidence

- PR #358 (F4); issue #359 (error ledger and per-site ownership proposal).
- Round 1 review at `bb23ea1`; resolver commit `0308386`.
- Episode 2 (2026-10-23): the first live normal-session credit run at `0308386` was withheld because the single resolver treated any rejected command as a doc-check candidate, so a workflow `plan` command whose JSON mentioned doc-check was projected as stale doc-check evidence. One resolver is not enough: it also needs a precise candidate boundary (an explicit command target, never a data argument). The diagnosis came from a packet that consulted this record first, which pointed straight at the shared decision instead of a consumer patch.
