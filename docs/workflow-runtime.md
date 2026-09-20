# Workflow Runtime

Harness uses workflow state to **observe, explain, and remind**. It is not a numeric-budget scheduler.

## Product rule

The runtime follows **minimal rails, maximum freedom**:

- routing selects a useful topology and suggested skills;
- workflow state records useful evidence and unresolved obligations;
- verification hooks remind when evidence is missing;
- worktree/isolation checks warn when a safer execution shape is available;
- iteration, revision, replan, and worker counts are planning hints only.

None of those cognitive workflow conditions should trap a session or require a reset command.

The two intentionally separate hard boundaries are:

1. **Rule of 3** — the third matching failure pauses mutation until a zoom-out reflection is written;
2. **user/host permission and dangerous-action approval** — authorization boundaries such as the action gate.

## Runtime flow

```text
route
  -> selected workflow guidance
  -> execute freely
  -> observe edits / verification / stage evidence
  -> emit reminders when evidence is weak
  -> complete or continue

same failure signature x3
  -> zoom-out reflection required
  -> reflection accepted
  -> normal execution resumes
```

There is no `budget-exhausted -> blocked -> reset-budget` lifecycle.

## Numeric guidance

Router plans may still expose values such as:

- `maxIterations`
- `maxRevisionRounds`
- `maxReplans`
- `maxWorkers`

These are **advisory defaults**, useful for prompts, diagnostics, or planning. Runtime hooks do not maintain authoritative counters, reserve mutation capacity, or reject the Nth event.

A long loop should produce a message such as:

> Iterative work is getting long; verify assumptions or consider re-planning.

It should not create a lock.

## Mutation observation

The previous mutation-probe subsystem and `.mutation-probes.lock` were removed by #190. Shell classification is now best-effort evidence for reminders. A false positive/negative must not deadlock work.

Direct edits can still update `lastMutationAt`. Shell outcomes can update handoff evidence heuristically. Missing or ambiguous evidence degrades reminder quality, not execution availability.

## Completion

`workflow-stop-gate.js` and `stop-gate.js` are reminder surfaces. When verification or Fable stage evidence is incomplete they report the missing evidence and return success to the host.

A workflow may retain `blocked` as a descriptive status recorded by the controller or legacy state, but workflow hooks do not use that value as a persistent execution lock.

## Fable and worktrees

Fable stage graphs, dependencies, write sets, and objective checks remain useful planning/evidence structures. `maxWorkers` no longer chunks ready stages as a hard concurrency cap.

For major work, a linked worktree remains strongly recommended. Missing isolation is surfaced prominently, but Harness-owned cognitive workflow hooks do not turn it into a self-deadlocking runtime state.

## Legacy state

Existing sessions may contain `budget.state = "budget-exhausted"`, old counters, or mutation-probe files from earlier versions. Current runtime code treats the budget API as advisory compatibility only and creates no new mutation-probe state.

Starting a fresh session remains the cleanest way to discard old evidence, but it is no longer required to recover from numeric budget exhaustion.

## Testing contract

Regression tests should prove:

- reminders fire when relevant;
- commands/Stop remain available;
- no mutation-probe lock or reservation state is created;
- `exec_command` verification can update `lastVerifyAt`;
- Rule of 3 trips exactly at three matching failures;
- a valid reflection resets the cycle;
- a later three-failure cycle requests another reflection rather than a permanent hard lock;
- permission/dangerous-action boundaries remain separate and intact.
