# Semantic Contracts and Safety Boundary Diagnostic Flows

Harness deliberately separates **semantic obligation strength** from **mechanical enforcement** and from **authorization/safety boundaries**. Canonical MUST/SHOULD/MAY definitions live in [philosophy.md](philosophy.md#contract-strength-must--should--may).

## Classification

| Mechanism / obligation | Semantic strength | Runtime behavior | Hard block? |
|---|---|---|---|
| Workflow routing / selected topology | **MUST** resolve required obligations | Observe/remind about unresolved lifecycle evidence | No |
| Suggested skill applicability | **MUST** evaluate; applicable core contract **MUST** run | Kernel/instructions expose dispositions | No |
| Iteration/revision/replan/worker numbers | **MAY** guide planning | Planning hints only | No |
| Verification before claim | **MUST** | Stop/hooks remind when evidence is missing | No |
| Boundary guard / huge-noisy context | **SHOULD** narrow reads/searches | Warn | No |
| Destructive overwrite target inspection | **MUST** establish current state | Depth guard reminds/fails open on mechanism errors | No |
| Tier-3/Fable isolation disposition | **MUST** resolve worktree or degraded fallback | Warn when unresolved | No |
| Subagent declared scope / unexpected writes | **MUST** respect and reconcile | Report ambiguous/out-of-scope changes | No |
| Commit scope | Staged diff review **MUST**; split unrelated concerns **SHOULD** | Atomic-commit reminder | No |
| Fable stage/check/synthesis/verifier | **MUST** when selected | Record pass/fail/ambiguity/dependency evidence and remind | No |
| Rule of 3 | Third matching failure **MUST** trigger zoom-out | Pause mutation until reflection | **Yes — intentional cognitive boundary** |
| Action/permission gate | Approval **MUST** precede governed side effects | Host/user authorization | **Yes — trust boundary** |

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

> If observing a semantic obligation would require another lock, lease, heartbeat, counter-recovery protocol, or parser exception, use a reminder instead. The reminder changes the **mechanism**, not the obligation's MUST/SHOULD/MAY strength.

## Troubleshooting

When a Harness message appears:

1. If it is a **Reminder**, use the evidence to improve the next action, but there is no Harness reset needed.
2. If it is the **Rule of 3** third-failure boundary, complete the requested zoom-out report.
3. If it is an **action/permission** decision, follow the host/user approval flow.
4. Do not edit Harness state files merely to recover from a numeric workflow limit; those limits are no longer enforced.
