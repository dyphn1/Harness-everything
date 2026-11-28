---
id: E-0007
signature: guard-fix-by-instance-not-class
class: fix-loop
title: "A dependency-exclusion overlap guard was fixed one field or spelling at a time instead of by predicate class, leaving false positives and wildcard false negatives"
sites:
  - hooks/scripts/lib/doc-reconciliation-producer.js
  - scripts/system-one-cycle/package.js
  - harness-everything/scripts/system-one/install.js
  - harness-everything/scripts/system-one/provider.js
  - scripts/system-one-cycle/score.py
  - scripts/system-one-curves.js
violates: "Advisor answer 18 section 1: \"an explicit task/requirement input intersecting it blocks the exclusion\" (only genuine inputs, not identity metadata, may block); and \"Broad/unknown selectors that may intersect are not evidence of disjointness.\" The record covers both false positives and false negatives in this input class."
scope: in
status: mechanism
mechanism_ref: "code-review/templates/finding.template.md @ blob 72f0068729554f3b7d3bf65b93e131f49ed0e100"
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
        review: "review-8 (OpenCode): no findings"
        result: "closed the mixed-case row"
      - round: 7
        change: "Commit `bd00a796`: absolute glob before the workspace boundary (`/tmp/*/node_modules/**`) is may-intersect unless its literal prefix is neither the workspace nor an ancestor"
        review: "PR #396 owner review (source-traced) found the class; review-9 (OpenCode)"
        result: "review-9 found a symlinked entry under a disjoint prefix still evades"
      - round: 8
        change: "Commit `2514056f`: every absolute glob outside the workspace is may-intersect; only literal outside paths stay disjoint"
        review: "hosted CI (incl. Windows) and owner U5 merge of #396; no independent review after this round"
        result: "merged in #396 (`f571ec68`)"
  - episode: 412-target-path-acceptance
    feature: "#412 E1 writer contract, B→O target-path acceptance"
    date: 2026-11-08
    closed: true
    rounds:
      - round: 0
        change: null
        review: "review-12"
        result: "pinned target that is a symlink outside the root was credited for Write and git add (executed probe)"
      - round: 1
        change: "Commit `782e19f7`: shared filesystem proof (no symlink components, regular leaf) + O tree entry mode 100644/100755"
        review: "review-13"
        result: "symlink and O-mode controls held, but `./` and `..` aliases of the same target were still credited — second consecutive round on the same decision"
      - round: 2
        change: "Commit `22dc944a`: one exact-spelling recognizer for capture and all writer surfaces, built from pinned targets and the captured/canonical root, applied before normalization; advisor-gated sweep of nine families × four surfaces"
        review: "review-14 (independent family sweep, executed)"
        result: "no actionable findings; episode closed"
  - episode: 425-w6-outcome-correlation-caller-inventory
    feature: "#425 W6 outcome-correlation repair"
    date: 2026-11-11
    closed: true
    rounds:
      - round: 0
        change: null
        review: "review round 2"
        result: "The repair packet for \"final-review failure is ignored when a success exists\" named two seams of the shared helper `agentResultSurface()` instead of requiring a caller inventory; fix `2fbcaa4f` closed exactly those two"
      - round: 1
        change: "Commit `c6dab126`: third caller `reviewRecordIndependent()` fixed"
        review: "coordinator gates"
        result: "`agentResultSurface()` had 0 callers; episode closed"
  - episode: 442-version-manifest-fix-by-sites
    feature: "#442 version-manifest contract"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: "R1 independent review on #442"
        result: "F4 changed only the manifest producer and the installer rejected it; F6 unified three sites but left `system-one-curves.js`. The fixes named failing sites, not the class of producers and consumers."
      - round: 1
        change: "Commit 1c0d8fcf: the trained catalog and `manifest.js` are the single source for every site"
        review: unknown
        result: "The class collapses to one source; episode open pending a closing review."
  - episode: 394-retirement-inventory
    feature: "#394 rule-of-3 retirement across hosts (PR #494)"
    date: 2026-11-20
    closed: true
    rounds:
      - round: 0
        change: null
        review: "verify:all --fast at 2a21bb33; review RV F1 (P1)"
        result: "The coordinator packet declared all of `plugins/**` generated by plugin:sync, but `plugins/harness-everything/hooks/hooks.json` is hand-maintained, so the Codex breaker stayed registered. The inventory grep matched only `rule-of-3`; `Rule of 3` / `same-signature` wording in openai-session-start.js, improve-codebase-architecture SKILL.md, docs/enforcement-locks.md and docs/workflow-runtime.md went unowned."
      - round: 1
        change: "`535c7ba6` finished packaged hooks, tests and platform docs; `b28c0c24` replaced count-triggered wording in tdd and shell rules"
        review: "RV2 / RV3 independent review; owner merge of PR #494"
        result: "Closed. Lesson: inventory a retired concept by every spelling and by every owner of each site, not by a glob assumption."
  - episode: 553-advisor-plan-caller-inventory-gap
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-27
    closed: false
    rounds:
      - round: 0
        change: null
        review: "G1 gate"
        result: "The advisor's round-5 plan for the E1 retirement missed callers. Packet P1 broke the H1 qualification and preparation replays (`ci/mechanism-325-3b-h1-qualification.test.js`, `ci/mechanism-325-3b-preparation.test.js`), surfaced at G1. Packet D1's write-set also missed the lifecycle doc tied to `ci/mechanism-2ax-doc-lifecycle.test.js`."
      - round: 1
        change: "Advisor answer 6 recorded the gap as a caller-inventory gap of this record and added in-scope packet T1e"
        review: "packet T1e"
        result: "`0 DONE`"
---

## Cue

A guard produces a false positive on real input and the fix names the one field that tripped it. Later, each repair closes one spelling (brace, `./`, mixed case) and a sibling spelling in the same class gets through.

## Lesson

Before writing the fix, replay the guard over the complete real live input and list every hit; fix the predicate that misclassifies the whole class, and put that real input in the test fixture. Enumerate the class (supported transformations plus unknown syntax) before the first fix, not one spelling per round. Re-check that the class fix does not open the opposite hole (here: wildcard syntax after relativizing).

Re-violated 2026-11-08 (#412): after the second round on the same decision, switching to an advisor-gated class invariant plus a family sweep closed it in one round.

Re-violated 2026-11-11 (#425): the same class on a repair packet — it named two seams instead of the class. Lesson addition: a repair packet for a decision class must require a pre/post caller inventory of the shared helper, pasted in the report.

Re-violated 2026-11-15 (#442): a five-site version-manifest contract (`package.js`, `install.js`, `provider.js`, `score.py`, `system-one-curves.js`) was repaired per failing site; `system-one-curves.js` escaped two fixes until an independent review (R1) found it. The successful correction (commit `1c0d8fcf`) removed the class by reducing every site to one shared source.

## Status and promotion

- `closed: false`. Round 6 is closed by review-8. Round 7 (review-9) found a symlink hole; round 8 merged in #396 with no independent review after it.
- Kept at `status: lesson`. The recorded lesson was re-violated across several rounds, so escalation to a mechanism is warranted, but `status: mechanism` requires an artifact that exists. None exists yet.
- **Proposed mechanism (not in place):** extend the "Counterexample categories covered" field in `code-review/templates/finding.template.md` into a required table: family, representative or equivalent spelling, expected result, actual result per implementation, and evidence tier or UNCHECKED. Reviewers derive the families from the scope anchor and enumerate supported transformations plus unknown syntax; uncovered families stay visible. Record the committed path or SHA as `mechanism_ref` after integration.
- The executable selector matrix in the dependency-scope test is the companion deterministic guard for this class. The review template is not CI-enforced.
- Do not read this as "converged in one round": review-7 found an unresolved boundary after the normalization repair, and no paired evidence shows the template speeds convergence.

## Evidence

- #341; live runs 12-14 of the row-17 kit; review finding on the absolute `?` selector.
- #396 reviews review-5, review-6 and review-7 (D7 sweeps); commits `3732b134`, `59037db8`, `2eb19883`, `b6aa96a3`; advisor adjudication (answer 21).
- #396 review-9 (OpenCode): symlinked entry under a disjoint prefix; commits `bd00a796`, `2514056f`; merged at `f571ec68`.
- #442 (2026-11-15): version-manifest fix-by-site; R1 independent review; fix commit `1c0d8fcf`.
- PR #494 (2026-11-20): inventory gaps fixed in `535c7ba6`, `b28c0c24`.
- #553 (2026-11-27, E1 retirement): the advisor's round-5 plan missed the H1 qualification and preparation replays, surfaced at G1; advisor answer 6 and packet T1e (`0 DONE`). Packet D1's write-set missed the lifecycle doc tied to `ci/mechanism-2ax-doc-lifecycle.test.js`. Re-violation of the retirement-inventory lesson from episode 394-retirement-inventory.
