---
id: E-0024
signature: one-shot-backgrounds-gate-then-exits
class: report-protocol
title: "A one-shot worker moved a long gate into the background to dodge its tool timeout, then exited without a report"
sites:
  - "opencode run one-shot worker (shell tool with a 10-minute foreground limit)"
  - "coordinator packet verification list (long verify:all row)"
violates: "End every report with `STATUS: DONE` or `STATUS: BLOCKED: <reason>`."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 476-w3-background-verify
    feature: "PR #476 CI fix, W3 packet (opencode hy4-flash-free)"
    date: 2026-11-19
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "W3 passed its focused gates, hit the shell tool's 10-minute limit on `npm run verify:all -- --fast`, relaunched it in the background and ended its turn saying it would resume when the run finished. A one-shot process never resumes, so it exited 0 with no report file. The coordinator treated the run as failed delivery and re-ran the gates itself."
---

## Cue

A one-shot worker's packet contains a gate that runs longer than the worker host's foreground tool limit (for example `verify:all` at about 10–20 minutes against a 10-minute shell limit).

## What happened

PR #476, packet W3: the edit and four focused gates were correct, but the `verify:all -- --fast` row exceeded the opencode shell tool limit. The worker backgrounded it and ended its turn expecting a completion callback. A one-shot `opencode run` exits when the turn ends, so no report was written and no STATUS line existed. W1 and W2 on the same PR ran the same gate in the foreground and finished, so the outcome depends on how the worker happens to handle the timeout.

## Lesson

- A one-shot worker must not background a gate it still needs to report on; there is no later turn.
- Packets either keep each gate under the worker host's foreground limit, or tell the worker to write the report with the long gate marked `UNCHECKED (host tool limit)` so the coordinator runs it.
- Related: E-0002 (missing terminal STATUS), E-0009 (one-shot environment limits), E-0013 (health checks catch the exit).

## Evidence

- PR #476, fix commit `7935939f`: the coordinator re-ran the focused gates and `verify:all -- --fast` itself (5 PASS, 0 FAIL) before pushing.
