---
id: E-0001
signature: doc-check-identity-split-decision
class: split-decision
title: "\"Is this the trusted doc-check?\" was decided independently at several sites"
sites:
  - hooks/scripts/lib/doc-reconciliation-pilot.js
  - hooks/scripts/lib/doc-reconciliation-provider.js
  - scripts/system-one-cycle/package.js
  - harness-everything/scripts/system-one/install.js
  - harness-everything/scripts/system-one/provider.js
  - scripts/system-one-cycle/score.py
  - scripts/system-one-curves.js
  - scripts/system-one-train.py
  - harness-everything/scripts/system-one/router.js
  - harness-everything/scripts/system-one/catalogs.js
  - opencode-plugin/index.mjs
  - "ci/mechanism-397-cycle-import.test.js (PR #448 branch; not on main at bd986013)"
  - "PR #448 plugin disposal and publication await sites"
violates: "#325 H3: claims alone, unavailable observations, stale bindings, unsupported waivers and contradictory runs cannot become a false PASS."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 325-f4-checker-identity
    feature: "#325 F4 credited reconciliation (PR #358)"
    date: 2026-10-22
    closed: true
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
      - round: 3
        change: "No identity change; closing evidence at 4899fbb"
        review: "Executed: verify:all 13 PASS / 0 FAIL at 4899fbb; invariant matrix S2-I1..S7-I1 CONTROL on source and packaged legs; mutants M1-M6 detected by their I1 owner cells (F4-T3 mutants log); R1/R2 self-authored and tampered doc-check earn nothing; live runs 4 and 5 credit only the installed checker"
        result: "Checker identity decided consistently; the fake-checker P1 and the case-variant P2 stay closed. Episode closed 2026-10-23 on executed evidence."
  - episode: 325-f4-l3-candidate-overcapture
    feature: "#325 F4 normal-session credit (PR #358), input 0308386"
    date: 2026-10-23
    closed: true
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
        result: "R7 finds no product defect, only test-oracle gaps (S1-I2 path-only delta, three A10 cells), closed by T4. Run 5 credits exactly doc-lint/link-check with review/verify pass and no generic verification from the doc-only run; Stops remind only for the separate L3-4 issue (#365). No new same-class finding. Owner closed the episode 2026-10-23; residual edge cases are left to observation (funnel: rules catch the bulk, LLM review handles the rest)."
  - episode: 442-version-manifest-identity-split
    feature: "#442 version-manifest contract (System One stage options)"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: "install failure"
        result: "F4 changed the manifest producer; the installer rejected it, because producer and installer decided the manifest identity independently."
      - round: 1
        change: "F6 unified three of the sites"
        review: "R1 independent review on #442"
        result: "Three sites shared one resolver, but `system-one-curves.js` still decided the manifest on its own."
      - round: 2
        change: "Commit 1c0d8fcf: the trained catalog and `manifest.js` are the single source of stage options"
        review: unknown
        result: "All five sites read one source; episode open pending a closing review."
      - round: 3
        change: null
        review: "owner independent review of c5a2747d (P2-1: validity option text in training differs from the served text)"
        result: "Observed, not fixed in this episode. Owner decision 2026-11-15 in issue #445: observe first, do not start the class fix without an owner go. 0 decision flips measured on 163 holdout and 1034 validation scorable pairs."
      - round: 4
        change: "F13 (input c5a2747d): scoreLive and routeLive accept the 12-id trained intent manifest, excluding unclassified as tier already does; RED S1-L06, control S1-L07"
        review: "live witness on the active s1-2026-11-15 package with the real resident: an actionable prompt returned null from scoreLive (13 serving intent ids against 12 trained); reported on #442 comment 6888498770"
        result: "Live path passes after the minimal fix. The class stays open in issue #445, which states five rounds on it and lists R1, F6, F7, F8, owner P2-1 and this live finding. F7 (commit 55e96b6e, fallout of the F6 validator) is not listed as a separate round here."
  - episode: 397-p1w-consumer-inventory
    feature: "#397 / PR #448 P1W OpenCode prompt binding"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: "local verify:all at 93ad886f and independent review R2 (one incident, one episode)"
        result: "P1W (861e55ec) made OpenCode V2 prompts require ctx.session.get. ci/mechanism-397-cycle-import.test.js was outside P1W's write-set because parallel packet W1 owned it, so P1W's consumer inventory skipped it. Local verify:all reported 'OpenCode observations were not captured'. R2 reported it as P2 (violates: unresolved)."
      - round: 1
        change: "Commit 5a55a8f7: the cycle-import v2 fixture gets the session lookup"
        review: unknown
        result: "Fixed on the branch. No closing review is recorded, so the episode stays open."
  - episode: 448-v2-consumer-translation
    feature: "#448 V2 consumer translation (owner review round 2)"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: "owner review round 2 of PR #448"
        result: "Owner round-2 review found a stale binding after a failed identity lookup (split-decision facet of two P1s; the V2 lifecycle event/session-id facet is recorded on E-0006)."
      - round: 1
        change: "Commit 5371ead2: clear the stale binding after a failed identity lookup and translate the V2 lifecycle event and session id for the enforcement handler"
        review: unknown
        result: "Fixed on the branch. No closing review is recorded, so the episode stays open."
  - episode: 448-disposal-liveness
    feature: "#448 plugin disposal liveness"
    date: unknown
    closed: false
    rounds:
      - round: 0
        change: null
        review: "R3 independent review on PR #448"
        result: "R3 found late publication after plugin disposal — the second blocker on PR #448 after the repair budget."
      - round: 1
        change: "Commit a0f8204a: publication fixed across all await sites"
        review: "RD1 independent review"
        result: "RD1 found disposal still awaits an unresolved host session.context() read. Episode open; owner decision pending."
  - episode: 501-ledger-rule-two-parsers
    feature: "#394 lesson injection (PR #501)"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: "independent review RV on PR #501 (executed)"
        result: "errors-sync parsed match rules from YAML while the runtime matcher read the same frontmatter with its own line parser; a valid quoted scalar passed sync and silently missed at runtime."
      - round: 1
        change: "da046171: runtime reads rules only from the generated index row, checked by a generated frontmatter binding; the runtime YAML parser is removed"
        review: "closing re-review RV2 (executed)"
        result: "quoted rules select in both phases; episode closed"
---

## Cue

Two or more review rounds in a row each find a new defect in the same acceptance decision, here whether a command is the trusted doc-check, while every command succeeds.

## What happened

The parser, the capture candidate filter, the installed-path check and the digest check each answered "is this the trusted checker?" on their own. Each fix closed one site, and the next review found another site deciding differently. Nine F4 fix rounds ran before anyone classified the findings.

## Lesson

Stop point-fixing after the second same-class round. List the findings by decision class, name the violated clause, inventory every site that makes the decision (including unchanged consumers), then choose the smallest justified correction and re-trace one normal acceptance path. See the zoom-out repair-loop trigger.

Episode 2 adds: one shared decision is not enough when its consumers need opposite error trade-offs. Selecting evidence references wants few false positives; granting trust (generic verification, reviewer independence) wants few false negatives. A scanner tuned for the first, patched one shell syntax per round, kept leaking into the second. Split them: a bounded recognizer selects references, and a conservative, parse-free rule denies trust to anything that is not a plain command.

Episode 3 adds: a version-manifest identity was decided at five sites (`package.js`, `install.js`, `provider.js`, `score.py`, `system-one-curves.js`). F4 changed one producer and the installer rejected it; F6 unified three sites and missed `system-one-curves.js`, which only an independent review (R1 on #442) found. The unit is not one resolver but one source of truth; commit `1c0d8fcf` made the trained catalog and `manifest.js` that source.

## Evidence

- PR #358 (F4); issue #359 (error ledger and per-site ownership proposal).
- Round 1 review at `bb23ea1`; resolver commit `0308386`.
- Episode 2 (2026-10-23): the first live normal-session credit run at `0308386` was withheld because the single resolver treated any rejected command as a doc-check candidate, so a workflow `plan` command whose JSON mentioned doc-check was projected as stale doc-check evidence. One resolver is not enough: it also needs a precise candidate boundary (an explicit command target, never a data argument). The diagnosis came from a packet that consulted this record first, which pointed straight at the shared decision instead of a consumer patch.
- Episode 3 (2026-11-15, #442): version-manifest identity at five sites; R1 independent review found the missed `system-one-curves.js`; fix commit `1c0d8fcf`.

## Episode 3 extension (2026-11-15, #445)

Issue #445 groups R1, F6, F7, F8, owner review P2-1 and the live intent finding (F13) as one class of stage option catalogs. Rounds 3 and 4 add P2-1 (observed, no fix) and F13 (minimal live fix). The class fix is not started and needs an owner go. The live finding is recorded as a round of this episode, not as a second #442 episode.

## Episode 4 (2026-11-15, #397 / PR #448)

P1W (`861e55ec`) made V2 prompts require `ctx.session.get`. Its consumer inventory skipped `ci/mechanism-397-cycle-import.test.js`, because a parallel packet owned that file. Inventorying every consumer, including unchanged ones and regardless of write-set, would have caught it. Fixed in `5a55a8f7`.

## Episode 5 (2026-11-15, PR #448 owner review round 2)

The owner's round-2 review of PR #448 found two P1s: the V2 lifecycle event and session id were not translated for the enforcement handler, and a binding stayed stale after a failed identity lookup. Both were fixed in commit `5371ead2`. This record carries the stale-binding facet; the host-protocol facet is recorded on E-0006. Second owner round in this V2 class.

## Episode 6 (PR #448, disposal liveness)

R3 found late publication after plugin disposal — the second blocker on PR #448 after the repair budget. D1 (`a0f8204a`) fixed publication across all await sites; the independent review RD1 then found that disposal still awaits an unresolved host `session.context()` read. Episode open; owner decision pending.
- PR #501: review finding 1, fix `da046171`. Same session: three separate harness-label parsers (dispatch readiness, dispatch status read, report writer) were each patched in PR #499; unifying them is open.
