---
id: E-0012
signature: herdr-wait-matches-echoed-command
class: tooling-friction
title: "A Herdr wait matched text inside its own echoed command, so it returned before the reviewer finished"
sites:
  - "coordinator Herdr pane dispatch (`herdr pane wait-output`)"
violates: "unknown"
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 396-review8-herdr-wait-echo
    feature: "#396 review-8 coordinator dispatch"
    date: 2026-11-07
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "`wait-output --match 'REVIEW8-EXIT='` matched the echoed command line, so the wait returned before the reviewer finished"
      - round: 1
        change: "Match a value only the finished command prints (`--regex 'DONE9 [0-9]+'`)"
        review: coordinator
        result: "later waits returned at the real exit"
---

## Cue

A coordinator waits on a Herdr pane for a marker string, and the wait returns before the dispatched command has finished.

## What happened

The wait pattern appeared in the command line the pane echoed, so the match fired at once. The reviewer had not finished.

## Lesson

The match text must not appear in the command itself. Match a value only the finished command prints, for example `--regex 'DONE9 [0-9]+'`.

## Evidence

- #396 review-8 dispatch (coordinator-run, 2026-11-07).
