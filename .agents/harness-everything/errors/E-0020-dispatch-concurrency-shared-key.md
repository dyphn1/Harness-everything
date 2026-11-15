---
id: E-0020
signature: parallel-opencode-shared-key-429
class: dispatch-concurrency
title: "Three parallel opencode workers on one API key hit HTTP 429 and exited without a STATUS line"
sites:
  - "opencode run dispatch with one shared nvidia API key"
violates: unknown
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 397-o4-parallel-429
    feature: "#397 packet O4 rev 1"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Three parallel opencode run processes on the same nvidia key returned HTTP 429 and one exited without a STATUS line. Packet O4 rev 2 moved to codex. Rule adopted: cap 2 opencode workers per key, route the third to another runner. No verification of the cap is recorded yet."
---

## Cue

Several one-shot workers are dispatched in parallel against the same runner API key, and some of them fail with rate-limit errors or exit with no report.

## What happened

Three parallel `opencode run` workers shared one nvidia key. The provider returned HTTP 429, and one worker exited without a `STATUS:` line. Packet O4 was re-dispatched as revision 2 on a different runner.

## Lesson

Cap concurrent opencode workers at 2 per key. Send any third worker to another runner. A worker that exits with no `STATUS:` line is a failed run, so re-dispatch it fresh.

## Evidence

- Packet O4 rev 1 (#397) and its rev 2 re-dispatch.
- Related: E-0009 covers runner environment limits and quota. Its lesson (ping the model first, prefer a paid runner after one failed delivery) does not cover concurrency on a shared key, so this is a separate class.
