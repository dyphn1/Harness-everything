---
id: E-0026
signature: changelog-duplicate-unreleased-heading
class: tooling-friction
title: "A CHANGELOG note added a second `## [Unreleased]` heading at the top instead of using the existing one"
sites:
  - CHANGELOG.md
  - "test:release (release-unreleased-heading)"
violates: "AGENTS.md Change Rule 8: human notes go under `[Unreleased]`; semantic-release owns stable headings"
scope: in
status: open
mechanism_ref: "test:release (release-unreleased-heading)"
episodes:
  - episode: 394-retirement-changelog-note
    feature: "#394 rule-of-3 retirement note (PR #494)"
    date: 2026-11-20
    closed: true
    rounds:
      - round: 0
        change: null
        review: "test:release (release-unreleased-heading)"
        result: "The coordinator added a new `## [Unreleased]` at the top of CHANGELOG.md; the existing one sits below the released entries. The release check caught the duplicate."
      - round: 1
        change: "`877456b4` kept one unreleased heading"
        review: "test:release"
        result: "episode closed"
---

## Cue

Adding a human note to CHANGELOG.md.

## What happened

The note went under a fresh `## [Unreleased]` at the top of the file, while the real one sits further down below released entries. `test:release` rejected the duplicate.

## Lesson

- Run `grep -n Unreleased CHANGELOG.md` first and add the note under the existing heading.
- The check already exists (`test:release`); run it locally before pushing a CHANGELOG edit.

## Evidence

- PR #494: fix commit `877456b4`.
