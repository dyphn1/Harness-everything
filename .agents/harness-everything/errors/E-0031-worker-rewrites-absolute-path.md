---
id: E-0031
signature: worker-rewrites-absolute-path
class: tooling-friction
title: "An agy worker rewrote a hyphen in the home-dir segment of an absolute path to a dot, tripping the workspace boundary guard on every write"
sites:
  - "agy one-shot worker dispatch (gemini-4-hydrogen-high)"
  - "Harness workspace boundary guard"
  - "coordinator packet path instructions"
violates: "Harness workspace boundary guard: writes must stay inside the workspace root."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 453-f1-absolute-path-rewrite
    feature: "#453 packet F1 attempt 1 (agy / gemini-4-hydrogen-high)"
    date: 2026-11-24
    closed: false
    rounds:
      - round: 0
        change: null
        review: "Harness boundary guard / worker report"
        result: "An agy worker (gemini-4-hydrogen-high) rewrote a hyphen in the home-dir segment of an absolute path to a dot; every write then hit the Harness boundary guard (\"modification outside workspace root\") and the run reported STATUS: BLOCKED."
      - round: 1
        change: "Packets tell agy workers to use paths relative to the current working directory only"
        review: unknown
        result: "Mitigation added to packet instructions; no closing review is recorded, so the episode stays open."
---

## Cue

A one-shot worker reports `STATUS: BLOCKED` because every file write hits the Harness workspace boundary guard ("modification outside workspace root"), even though the target files belong to the packet's write-set.

## What happened

On #453 packet F1 attempt 1, an `agy` worker (`gemini-4-hydrogen-high`) rewrote a hyphen in the home-dir segment of an absolute path to a dot. Because the rewritten path no longer matched the workspace root, every write was rejected by the Harness boundary guard and the run ended with `STATUS: BLOCKED`.

## Lesson

- Instruct `agy` one-shot workers in the packet to use paths relative to the current working directory only, avoiding hand-transcribed absolute paths that a model can normalize or mistype.
- When a worker hits repeated "modification outside workspace root" blocks on in-scope files, inspect the exact path spelling for single-character rewrites (such as hyphen-to-dot).

## Evidence

- #453 packet F1 attempt 1 (2026-11-24).
