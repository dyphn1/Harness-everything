---
id: E-0023
signature: packet-cut-too-wide
class: process
title: "A one-shot packet covering 13 sites, 8 rows and mutants ran about 60 minutes, past the 45-minute one-shot threshold"
sites:
  - "coordinator packet construction (D1 packet on PR #448)"
violates: unknown
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 448-d1-packet-overrun
    feature: "#448 D1 one-shot packet"
    date: 2026-11-17
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The D1 one-shot (PR #448) ran about 60 minutes, above the 45-minute threshold set 2026-11-13, because its packet covered 13 sites, 8 rows and mutants."
---

## Cue

A one-shot packet's scope (sites, table rows, mutation work) is large enough that the run exceeds the one-shot time threshold, and the overrun is discovered from the run's wall time.

## What happened

On 2026-11-17 the D1 one-shot packet (PR #448) ran about 60 minutes. The 45-minute threshold for one-shot runs had been set 2026-11-13. The packet covered 13 sites, 8 rows and mutants, which pushed the run past the threshold.

## Lesson

Cut a one-shot packet so its scope fits the time threshold: when the work needs many sites, rows or mutants, split it into several packets instead of one wide packet. Estimate the scope before dispatch (sites × rows × mutants), rather than discovering the overrun from the run's wall time.

## Evidence

- PR #448 (D1 packet, about 60 minutes).
- The 45-minute one-shot threshold was set 2026-11-13 (coordinator packet-store evidence; no PR or commit carries it).

## Classification note

A new record rather than an episode of E-0022: E-0022's class is the wording of coordinator/advisor briefing text; packet scope sizing is a different process failure with its own cue. E-0013 (health checks) and E-0015 (CI duration judgement) do not cover packet sizing either.
