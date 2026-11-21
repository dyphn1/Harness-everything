---
id: E-0003
signature: commitlint-subject-case-length
class: tooling-friction
title: "Commit subjects were rejected by commitlint for uppercase case and over-length headers"
sites:
  - commitlint.config.js
  - .husky/commit-msg
violates: "commitlint.config.js: \"'subject-case': [2, 'always', 'lower-case']\" and \"'header-max-length': [2, 'always', 100]\""
scope: in
status: lesson
mechanism_ref: .husky/commit-msg
match:
  actions:
    - tool: shell
      executable: git
      subcommand: commit
  failures:
    - tool: shell
      executable: git
      subcommand: commit
      diagnostics:
        - subject-case
        - header-max-length
        - type-empty
        - subject-empty
episodes:
  - episode: 325-3b-process-friction
    feature: "#325 Phase 3b process friction (retro row 3.9)"
    date: 2026-10-21
    closed: false
    rounds:
      - round: 0
        change: null
        review: unknown
        result: "The commit-msg hook rejected a subject for uppercase `subject-case` and, separately, a header for `header-max-length`; the source records two failures"
  - episode: 341-e1-live-kit-commits
    feature: "#341 E1 live row-17 cycles and stage-2 commits (PR #393)"
    date: 2026-10-29
    closed: false
    rounds:
      - round: 0
        change: null
        review: none
        result: "Operator O commit in the live kit was rejected for `subject-case`; the whole live host run was lost"
      - round: 1
        change: "Kit messages lower-cased as `docs(adr): ...`"
        review: live-run
        result: "The `(adr)` parentheses broke the exact `Bash(git commit -q -m ...)` permission rule; the drafter's commit was refused and a second live run was lost"
      - round: 2
        change: "Scope-less `docs: draft evid-001` messages, checked with `npx commitlint` before the run"
        review: live-run
        result: "Kit commits passed; later a coordinator commit header of 102 characters was rejected and the pin briefly kept the previous SHA"
  - episode: 341-e1-writer-contract-commit
    feature: "#412 E1 stage-2 writer contract"
    date: 2026-11-07
    closed: false
    rounds:
      - round: 0
        change: null
        review: "commit-msg hook"
        result: "subject `... approved E1 contract` rejected for `subject-case` (uppercase `E1`); fixed by lowering the subject"
  - episode: 418-ledger-commit-header-length
    feature: "#418 error-ledger batch (coordinator commit)"
    date: 2026-11-08
    closed: true
    rounds:
      - round: 0
        change: null
        review: "commitlint (husky commit-msg)"
        result: "coordinator commit header was 108 characters; `header-max-length` (100) rejected it — the recorded lesson was re-violated by the coordinator"
      - round: 1
        change: "header shortened to fit 100 characters"
        review: "commitlint"
        result: "commit accepted"
  - episode: 423-changelog-subject-case
    feature: "#423 CHANGELOG consolidation (coordinator commit)"
    date: 2026-11-10
    closed: false
    rounds:
      - round: 0
        change: null
        review: "commit-msg hook"
        result: "subject `chore(changelog): keep one [Unreleased] heading and guard it` rejected for `subject-case` (capital letters inside the brackets); the push ran before checking that the commit succeeded, so the branch was pushed without the commit"
      - round: 1
        change: "lower-case subject, committed as `18d73323`"
        review: unknown
        result: "commit accepted"
  - episode: 456-commitlint-subject-case-review-clone
    feature: "PR #456 (coordinator commit; review RH3)"
    date: 2026-11-18
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "A coordinator commit subject contained an uppercase word (\"Python\") and was rejected by `subject-case`; the reviewer had already been cloned, so it reviewed the previous head. The review RH3 was killed and re-dispatched on the corrected head. New lesson: check the commit's exit status before cloning a reviewer for it, and keep subjects lower-case"
  - episode: 471-commitlint-subject-case-system-one
    feature: "PR #471 (coordinator commit, C3 repair)"
    date: 2026-11-18
    closed: false
    rounds:
      - round: 0
        change: null
        review: "commit-msg hook"
        result: "A coordinator commit subject contained the proper noun \"System One\" and was rejected by `subject-case`; it was re-committed with a lower-case subject as `42b0a45f`. Same class as the same-day PR #456 \"Python\" episode."
  - episode: 476-errors-commit-subject-case
    feature: "#476 follow-up error-ledger commit (coordinator)"
    date: 2026-11-19
    closed: true
    rounds:
      - round: 0
        change: null
        review: "commitlint (husky commit-msg)"
        result: "subject `record the PR #476 CI fix episodes` rejected for `subject-case` (uppercase `PR`, `CI`); the recorded lesson was re-violated by the coordinator"
      - round: 1
        change: "subject lower-cased"
        review: commitlint
        result: "commit accepted"
  - episode: 479-merge-commit-without-type
    feature: "#479 integration branch (coordinator local merge)"
    date: 2026-11-19
    closed: true
    rounds:
      - round: 0
        change: null
        review: "commitlint (husky commit-msg)"
        result: "`git merge --no-ff -m \"merge p1 errors-sync --root into …\"` was rejected (`type-empty`, `subject-empty`); the merge stayed uncommitted until re-committed as `chore(errors): merge p1 …`. Merge commits on integration branches go through the same hook."
  - episode: 394-merge-message-without-type
    feature: "#394 rule-of-3 retirement integration merges (PR #494)"
    date: 2026-11-20
    closed: true
    rounds:
      - round: 0
        change: null
        review: commitlint
        result: "`git merge origin/main -m \"merge ...\"` rejected (subject/type empty); same as episode 479-merge-commit-without-type."
      - round: 1
        change: "Re-run as `chore(merge): ...` (`28e60098`)"
        review: commitlint
        result: "accepted"
---

## Cue

A commit is rejected locally by commitlint for the shape of its subject line — uppercase text or a header past the length limit — in the middle of a routine push or release.

## What happened

Row 3.9 of the #325 Phase 3b retrospective (2026-10-21) records that "Commitlint subject case and length failed twice". One rejection was for `subject-case`: the subject was not lower case. The other was for `header-max-length`: the header exceeded 100 characters. The two failures cost a corrected re-commit each. No commit SHA is recorded for either rejected attempt, and the retrospective lists no review round for them — they are process friction, not a reviewed defect.

The occurrence count is `unknown`: the retrospective says twice, the owner's memory says the uppercase-subject failure happened three times (×3). No source in this clone resolves which count is right, so the record keeps the two occurrences the retrospective names and leaves the third unreconciled.

## Lesson

Check the subject line against both rules before committing: lower case (`subject-case`) and at most 100 characters (`header-max-length`). The existing `.husky/commit-msg` hook already runs commitlint on the message, so the failure surfaces at `git commit`, not in CI. The retrospective's prevention candidate — a pre-push helper that checks mergeability and commit-message lint — does not exist yet.

## Evidence

- Coordinator retrospective for #325 Phase 3b (2026-10-21, unpublished), row 3.9. Which rule each rejection hit is not recorded there; the split above is the most likely reading.
- Rule text: `commitlint.config.js`; enforcement: `.husky/commit-msg`.

## Episode 2 (2026-10-29, #341)

The ledger already held this class, but no packet or coordinator step consulted it, so it repeated three times in one session: twice inside a live operator kit (each costing a full host run) and once on a coordinator commit. A permission-rule interaction is new: a message containing parentheses cannot be expressed as an exact `Bash(...)` allow rule. Lesson added: validate every planned commit message with `npx commitlint` before a live run, keep allowlisted messages free of parentheses, and check the header length before committing. Point-of-action injection of this entry is proposed in #394.

## Episode 5 (2026-11-10, #423)

New failure mode in the same class: the push ran before checking that the commit succeeded, so the rejected commit left the branch pushed without it. Lesson added: run commitlint on the message file **before** `git commit`, and check the commit exists before pushing.

## Episode 6 (2026-11-18, PR #456)

A coordinator commit subject contained an uppercase word ("Python") and was rejected by `subject-case`. The reviewer had already been cloned before the failed commit was noticed, so it reviewed the previous head; the review RH3 was killed and re-dispatched. Lesson added: check the commit's exit status before cloning a reviewer for it, and keep subjects lower-case.

## Episode 7 (2026-11-18, PR #471)

A coordinator commit subject contained the proper noun "System One" and was rejected by `subject-case`; it was re-committed with a lower-case subject as `42b0a45f`. Same class as the same-day PR #456 "Python" episode. Lesson unchanged: keep proper nouns lower-case in subjects and check the commit's exit status before downstream steps.

## Episode (2026-11-19, #476 follow-up)

The coordinator wrote `docs(errors): record the PR #476 CI fix episodes`; commitlint rejected the uppercase `PR`/`CI`. Lowering the subject fixed it. A repeat by the coordinator, again without running `npx commitlint` before committing.

## Episode (2026-11-19, #479 integration merge)

A coordinator `git merge --no-ff -m` message had no conventional type and was rejected by commitlint; the merge was completed with a `chore(errors): merge …` message. Lesson added: local merge commits into an integration branch need a conventional message too.
- PR #494 (2026-11-20): merge message without type rejected; re-run as `chore(merge)` in `28e60098`.
