---
id: E-0014
signature: lossy-cleanup
class: lossy-cleanup
title: "A worker told to drop CHANGELOG entries 'already listed' removed human-written notes that were only similar to generated lines"
sites:
  - CHANGELOG.md
violates: "Coordinator lossless check for content cleanup: every removed `* ` line must still exist verbatim."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 423-changelog-lossy-drop
    feature: "#423 CHANGELOG consolidation (issue #415)"
    date: 2026-11-10
    closed: true
    rounds:
      - round: 0
        change: null
        review: "coordinator lossless check (every removed `* ` line must still exist verbatim)"
        result: "worker dropped 25 human-written notes whose wording was only similar to generated release lines; the lossless check caught it"
      - round: 1
        change: "revision 2: drop only byte-identical duplicates"
        review: "coordinator lossless check"
        result: "0 lines lost; episode closed"
---

## Cue

A cleanup packet deletes content under a fuzzy notion of "already present" or "duplicate", and the surviving text is missing lines nobody intended to lose.

## What happened

Revision 1 of the #423 CHANGELOG cleanup told the worker to drop entries "already listed". It dropped 25 human-written notes whose wording was only similar to generated release lines. The coordinator's lossless check — every removed `* ` line must still exist verbatim — caught the loss. Revision 2 narrowed the rule to "drop only byte-identical duplicates" and lost 0 lines.

## Lesson

Cleanup packets that delete content must define equality as exact bytes and require a removed-lines-still-present self-check. Similar wording is not a duplicate.

## Evidence

- PR #423, issue #415 (CHANGELOG consolidation, 2026-11-10).
