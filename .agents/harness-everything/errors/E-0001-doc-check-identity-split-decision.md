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
      - round: 1
        change: "W12 fd3833e: shared command-target candidate boundary; normal and malformed controls"
        review: "R5 substantive review of fd3833e; live Run 3 at f226c3c"
        result: "Normal plan-mention path credits exactly doc-lint/link-check and review/verify pass. R5 finds in-scope P3: shell comment text still becomes a candidate. Episode remains open."
      - round: 2
        change: "W13 5466cfb: stop candidate scanning at an unquoted word-start shell comment; retain quoted/mid-word hash and explicit checker controls"
        review: "A9 focused source/resolver review at 5466cfb; full closing review unknown"
        result: "Original comment witness resolves and direct/wrapped controls retain their kinds. Pre-existing multiline checker candidate is missed; naive newline splitting misclassifies heredoc data. In-scope boundary follow-up remains; episode open."
      - round: 3
        change: "Z2 a9a8807: split executable newlines and skip simple heredoc bodies; integrated at 0c53a57"
        review: "R6 review of WB2/Z2 at 0c53a57; A10 class-level source and helper probes"
        result: "Normal Run 4 credits exactly lint/link with review/verify pass. R6 finds unquoted heredoc substitution hidden by scanner, permitting generic fallback. A10 confirms full generic predicate and omitted reviewer executor; escaped target spelling defeats raw-substring-only guard. Episode remains open."
      - round: 4
        change: "W14 f9b3e92: class-level split, conservative parse-free trust rule (compound or checker-marked commands get no generic verification or reviewer independence); T3 feac455 and T4 4899fbb test-only reconciliation"
        review: "R7 independent review of W14 + T3 at 267402e; live Run 5 at 4899fbb"
        result: "R7 finds no product defect, only test-oracle gaps (S1-I2 path-only delta, three A10 cells), closed by T4. Run 5 credits exactly doc-lint/link-check with review/verify pass and no generic verification from the doc-only run; Stops remind only for the separate L3-4 issue (#365). No new same-class finding. Closing awaits owner acceptance."
---

## Cue

Two or more review rounds in a row each find a new defect in the same acceptance decision, here whether a command is the trusted doc-check, while every command succeeds.

## What happened

The parser, the capture candidate filter, the installed-path check and the digest check each answered "is this the trusted checker?" on their own. Each fix closed one site, and the next review found another site deciding differently. Nine F4 fix rounds ran before anyone classified the findings.

## Lesson

Stop point-fixing after the second same-class round. List the findings by decision class, name the violated clause, inventory every site that makes the decision (including unchanged consumers), then choose the smallest justified correction and re-trace one normal acceptance path. See the zoom-out repair-loop trigger.

Episode 2 adds: one shared decision is not enough when its consumers need opposite error trade-offs. Selecting evidence references wants few false positives; granting trust (generic verification, reviewer independence) wants few false negatives. A scanner tuned for the first, patched one shell syntax per round, kept leaking into the second. Split them: a bounded recognizer selects references, and a conservative, parse-free rule denies trust to anything that is not a plain command.

## Evidence

- PR #358 (F4); issue #359 (error ledger and per-site ownership proposal).
- Round 1 review at `bb23ea1`; resolver commit `0308386`.
- Episode 2 (2026-10-23): the first live normal-session credit run at `0308386` was withheld because the single resolver treated any rejected command as a doc-check candidate, so a workflow `plan` command whose JSON mentioned doc-check was projected as stale doc-check evidence. One resolver is not enough: it also needs a precise candidate boundary (an explicit command target, never a data argument). The diagnosis came from a packet that consulted this record first, which pointed straight at the shared decision instead of a consumer patch.
