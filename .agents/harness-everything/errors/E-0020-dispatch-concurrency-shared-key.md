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
  - episode: 471-c8-quota-detection-too-broad
    feature: "PR #471 C8 (one-shot runner template)"
    date: 2026-11-18
    closed: false
    rounds:
      - round: 0
        change: null
        review: "coordinator probe before dispatch"
        result: "The template's `quota_hit` scanned the whole run log for `quota|429`, so a compliant run whose log quoted the E-0020 policy would be classified as a quota hit. Caught before dispatch by a coordinator probe."
      - round: 1
        change: "C8 repair (5b547bc6): match runner error lines only"
        review: unknown
        result: "Fixed on the branch. No closing review is recorded, so the episode stays open."
  - episode: 461-o2-slow-provider-no-report
    feature: "PR #461 O2"
    date: 2026-11-18
    closed: true
    rounds:
      - round: 0
        change: null
        review: "coordinator, 45-minute alarm"
        result: "`nvidia/minimaxai/minimax-m3.1-flash` hit the 45-minute alarm without a report (exit 142) while sharing its key with a model probe; re-dispatched fresh on `opencode/hy4-flash-free`, which finished. Closest class with ambiguity noted in the body."
---

## Cue

Several one-shot workers are dispatched in parallel against the same runner API key, and some of them fail with rate-limit errors or exit with no report.

## What happened

Three parallel `opencode run` workers shared one nvidia key. The provider returned HTTP 429, and one worker exited without a `STATUS:` line. Packet O4 was re-dispatched as revision 2 on a different runner.

## Lesson

Cap concurrent opencode workers at 2 per key. Send any third worker to another runner. A worker that exits with no `STATUS:` line is a failed run, so re-dispatch it fresh.

Episode 2 adds: scope quota detection to runner error lines. Matching `quota|429` anywhere in the log turns a compliant run that quotes this policy into a false quota hit.

Episode 3 adds: a slow provider can hit the one-shot time alarm without a report; re-dispatch fresh rather than treating the silent exit as a result. The primary cause here is a slow provider, so the concurrency classification is noted as ambiguous.

## Evidence

- Packet O4 rev 1 (#397) and its rev 2 re-dispatch.
- Related: E-0009 covers runner environment limits and quota. Its lesson (ping the model first, prefer a paid runner after one failed delivery) does not cover concurrency on a shared key, so this is a separate class.
- Episode 2 (2026-11-18, PR #471 C8): `quota_hit` false positive; repair `5b547bc6` (runner error lines only).
- Episode 3 (2026-11-18, PR #461 O2): 45-minute alarm, exit 142, no report; re-dispatched on `opencode/hy4-flash-free`.

## Episode 2 (2026-11-18, PR #471 C8)

A detection defect in the opposite direction from the original 429 episode: the template's `quota_hit` matched `quota|429` anywhere in the run log, so a compliant run whose log quoted the E-0020 policy was classified as a quota hit. A coordinator probe caught it before dispatch; the C8 repair (`5b547bc6`) matches runner error lines only. Lesson: scope quota detection to runner error output, not arbitrary log text.

## Episode 3 (2026-11-18, PR #461 O2)

`nvidia/minimaxai/minimax-m3.1-flash` hit the 45-minute alarm without a report (exit 142) while sharing its key with a model probe; a fresh re-dispatch on `opencode/hy4-flash-free` finished. Closest class is this record (shared key / worker exits without a report), with E-0013 (health checks) and E-0023 (45-minute threshold) also relevant; the primary cause — a slow provider — is not conclusively the shared key, so the classification is ambiguous. Resolution: a worker that exits without a report is failed and is re-dispatched fresh.
