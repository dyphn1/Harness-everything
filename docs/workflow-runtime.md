# Workflow Runtime

Harness uses workflow state to **observe, explain, and remind about semantic contracts**. It is not a numeric-budget scheduler, and reminder-only mechanics do not make MUST obligations optional.

## Product rule

The runtime follows **minimal rails, maximum freedom**:

- routing **MUST** establish the selected/deferred topology and suggested-skill applicability set;
- workflow state records useful evidence and unresolved obligations without becoming a cognitive lock;
- selected-topology required obligations and applicable skill core contracts are semantic **MUSTs**;
- the agent **MUST** verify before claiming completion and use the single user-visible Harness Status at required phase boundaries for non-trivial work;
- verification hooks may only remind when evidence is missing, but the semantic verification obligation remains **MUST**;
- Tier-3/Fable broad mutation **MUST** resolve isolation disposition: verified linked worktree or explicit degraded fallback;
- iteration, revision, replan, and worker counts are **MAY** planning hints only.

None of those cognitive workflow conditions should trap a session or require a reset command.

A semantic MUST is not the same thing as a hard runtime lock. User-visible status, routing/applicability obligations, and verification-before-claim can remain mandatory agent contracts while host hooks observe or remind on a best-effort basis. Do not downgrade a semantic obligation to optional advice merely because the host cannot block it.

The unified status shape uses a visible Markdown hierarchy:

```md
### 🚦 Harness Status

- **Current:** <what is being done now>
- **Read / Evidence:**
  - <important file/source/evidence read or confirmed>
  - <another item when multiple evidence items improve scanability>
- **Next:** <next intended action>
- **Risk / Blocked:** <only when materially applicable; omit otherwise>
```

Keep one short evidence item inline; use nested evidence bullets when multiple items improve scanability. Emit it before substantive execution, after major phases, on material direction changes, at meaningful long-running phase boundaries, and before final completion.

The two intentionally separate hard boundaries are:

1. **Rule of 3** — the third matching failure pauses mutation until a zoom-out reflection is written;
2. **user/host permission and dangerous-action approval** — authorization boundaries such as the action gate.

## Runtime flow

```text
route
  -> selected workflow semantic contract
  -> execute with model-chosen tactics
  -> observe edits / verification / stage evidence
  -> emit reminders when evidence is weak
  -> complete only when MUST obligations resolve

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

These are **MAY planning hints**, useful for prompts, diagnostics, or planning. Runtime hooks do not maintain authoritative counters, reserve mutation capacity, or reject the Nth event.

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

When a Fable topology is selected, its stage graphs, dependencies, write sets, objective checks, synthesis barrier, and required verifier are semantic **MUSTs**. `maxWorkers` remains a **MAY** planning hint and no longer chunks ready stages as a hard concurrency cap.

For Tier-3/Fable broad mutation, isolation disposition is a semantic **MUST**: use/reuse a verified linked worktree, or record an explicit degraded fallback when isolation is unavailable or the user explicitly chooses to stay in place. Missing isolation is surfaced prominently, but Harness-owned cognitive workflow hooks do not turn it into a self-deadlocking runtime state.

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
