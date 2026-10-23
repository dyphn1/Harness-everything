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
status: open
mechanism_ref: .husky/commit-msg
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
