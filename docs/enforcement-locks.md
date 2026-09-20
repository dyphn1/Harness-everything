# Guidance and Safety Boundary Diagnostic Flows

Harness deliberately separates **cognitive guidance** from **authorization/safety boundaries**.

## Classification

| Mechanism | Behavior | Hard block? |
|---|---|---|
| Workflow routing/state | Remind about selected topology, stale/blocked descriptive state, missing Fable correlation, or safer worktree usage | No |
| Iteration/revision/replan/worker guidance | Planning hints only | No |
| Verification / Stop | Remind when no successful verification is observed after an edit | No |
| Boundary guard | Warn about very large reads or noisy search roots | No |
| Depth guard | Remind when editing a file that has not been inspected | No |
| Subagent scope guard | Report ambiguous/out-of-scope changes for review | No |
| Atomic commit check | Warn when changes look broader than one atomic concern | No |
| Fable contract test | Record pass/fail/ambiguity/dependency evidence and warn | No |
| Rule of 3 | Third matching failure requires a zoom-out reflection before more mutation | **Yes — intentional cognitive boundary** |
| Action/permission gate | User/host authorization for destructive or external side effects | **Yes — trust boundary** |

## Rule of 3

```text
same signature #1 -> record
same signature #2 -> record
same signature #3 -> pause mutation and require zoom-out
reflection accepted -> count resets
later #1/#2/#3 -> another zoom-out
```

There are no category-specific 2/4 thresholds and no second-stage permanent hard lock.

## Workflow reminders

A workflow may be marked `blocked`, `failed`, or carry legacy `budget-exhausted` evidence. Those states are useful diagnostics but no longer cause `workflow-gate.js` to reject mutation.

Missing verification at Stop similarly produces a reminder rather than a bounce.

## Why #190 removed hard workflow enforcement

The previous numeric enforcement required mutation probes, stale-probe recovery, shared counters, exact-limit exceptions, shell classification, reset controllers, and a filesystem lock. #190 removed that chain instead of hardening it.

The design test is simple:

> If better cognitive guidance requires another lock, lease, heartbeat, counter-recovery protocol, or parser exception, prefer a reminder.

## Troubleshooting

When a Harness message appears:

1. If it is a **Reminder**, use the evidence to improve the next action, but there is no Harness reset needed.
2. If it is the **Rule of 3** third-failure boundary, complete the requested zoom-out report.
3. If it is an **action/permission** decision, follow the host/user approval flow.
4. Do not edit Harness state files merely to recover from a numeric workflow limit; those limits are no longer enforced.
