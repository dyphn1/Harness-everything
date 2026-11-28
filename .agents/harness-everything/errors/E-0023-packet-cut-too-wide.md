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
  - episode: 553-luna-xhigh-final-gate-timeout
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-27
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Packets P2b, T2-S and T2-P (codex gpt-6-luna xhigh; test-move and test-edit packets) each hit `15 RUN_TIMEOUT` (2700 s) during their final gates, with no worker report. Same-shape packets T3-Capture and G3fix on gpt-6-luna high finished `0 DONE` within 45 minutes."
      - round: 1
        change: "Coordinator salvaged the three diffs instead of re-dispatching fresh: it re-ran the affected suites and controls itself. This is a recorded deviation from the re-dispatch rule."
        review: "stage-1 independent review covers P2b; no review is stated for T2-S and T2-P"
        result: "PR #556 merged as `7e7a2cfb`"
---

## Cue

A one-shot packet's scope (sites, table rows, mutation work) is large enough that the run exceeds the one-shot time threshold, and the overrun is discovered from the run's wall time.

## What happened

On 2026-11-17 the D1 one-shot packet (PR #448) ran about 60 minutes. The 45-minute threshold for one-shot runs had been set 2026-11-13. The packet covered 13 sites, 8 rows and mutants, which pushed the run past the threshold.

## Lesson

Cut a one-shot packet so its scope fits the time threshold: when the work needs many sites, rows or mutants, split it into several packets instead of one wide packet. Estimate the scope before dispatch (sites × rows × mutants), rather than discovering the overrun from the run's wall time.

Effort matters too. Test-move and test-edit packets run on gpt-6-luna at effort high. At xhigh, three such packets hit the 45-minute `RUN_TIMEOUT` in their final gates, while same-shape packets at high finished within the limit (#553). When a timed-out run's diff is salvaged rather than re-dispatched, the coordinator records it as a deviation and re-runs the affected suites and controls before accepting it.

## Evidence

- PR #448 (D1 packet, about 60 minutes).
- The 45-minute one-shot threshold was set 2026-11-13 (coordinator packet-store evidence; no PR or commit carries it).
- #553 (2026-11-27/28, PR #556 merged as `7e7a2cfb`): `RUN_TIMEOUT` on xhigh test-move packets P2b, T2-S and T2-P; same-shape high packets T3-Capture and G3fix finished `0 DONE`; the three diffs were salvaged by the coordinator.

## Classification note

A new record rather than an episode of E-0022: E-0022's class is the wording of coordinator/advisor briefing text; packet scope sizing is a different process failure with its own cue. E-0013 (health checks) and E-0015 (CI duration judgement) do not cover packet sizing either.
