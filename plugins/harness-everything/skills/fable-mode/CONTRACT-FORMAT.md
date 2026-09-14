# Fable Stage Contract Format

Issue #85 Phase 3 makes the stage map a machine-readable execution contract.
The router still chooses only the execution topology. Fable owns the stage map,
model selector, worker briefs, stage audit, replan budget, and cold verifier.

Run state is stored under the existing workspace-keyed global Harness state
root, never inside the repository:

```text
<workspace-state>/state/fable-runs/<runId>/
  run.json
  contracts/<stageId>.json
  evidence/<stageId>.json
```

`planId` is a deterministic content hash of the router contract. `runId` is
unique per orchestration. Two runs of the same plan therefore share a `planId`
but never share mutable stage-contract files.

## Stage schema v2

Every planned stage declares dependency and write scope before dispatch:

```json
{
  "stageId": "stage-3",
  "goal": "implement one bounded objective",
  "agent": "fable-worker-sonnet",
  "task": "self-contained task statement",
  "inputs": ["relevant files", "upstream outputs"],
  "expectedOutputs": ["artifact or evidence"],
  "outputPath": "path/to/artifact-or-null",
  "dependsOn": ["stage-1"],
  "writeSet": ["src/auth", "tests/auth.test.js"],
  "checkCommand": "node --test tests/auth.test.js",
  "passCondition": "exit 0",
  "failureReturn": "failure summary + evidence + missing prerequisite"
}
```

Rules:

- `stageId`, `goal`, `agent`, and `task` are required.
- `dependsOn` is always explicit. Use `[]` for a root stage.
- `writeSet` is always explicit. Use `[]` for a read-only stage.
- `writeSet` contains concrete repository-relative path scopes, not globs,
  absolute paths, or `..` traversal.
- a directory scope covers descendants; overlapping scopes cannot run in the
  same parallel batch.
- every `dependsOn` target must exist; self edges and cycles are invalid.
- `checkCommand` is exact-match evidence when present. `passCondition` explains
  what that command proves; it does not replace the command result.
- workers do not widen their own `writeSet`. If scope must grow, return to the
  orchestrator and produce a revised plan before dispatch.

## Workflow-plan consumer

Before dispatch, write the router contract and stage array to files and run:

```bash
node fable-mode/scripts/workflow-plan-consumer.js \
  --plan-file <router-contract.json> \
  --stages-file <stages.json> \
  --root <workspace> \
  --run-id <optional-stable-run-label> \
  --session-id <optional-host-session-id>
```

The consumer validates the graph, derives `planId`, creates the isolated run
root, and emits execution batches. It consumes only router-owned decisions:
strategy, parallelism, verifier requirement, workspace/memory hints, limits,
and requested-model metadata. It does **not** choose a model or execute a
stage.

For `fable-parallel`, every ready batch must have resolved dependencies and
pairwise non-overlapping write sets. An invalid graph or overlap rejects the
plan before workers are spawned. For `fable-staged` and
`fable-multi-agent-workspace`, the same dependency graph is serialized unless
a later validated plan explicitly allows parallelism.

## Verification evidence

`contract-test.js` watches Bash/PowerShell calls and resolves an exact
`checkCommand` only when it can correlate the command to one run/stage. The
result updates the stage contract and writes:

```text
evidence/<stageId>.json
```

with `planId`, `runId`, `stageId`, command, exit code, status, and captured
evidence. If the same command is pending in multiple uncorrelated runs, the
hook updates none of them and reports the ambiguity.

Before delivery, every check-bearing contract in the run must be `pass` (not
`pending`, `planned`, `running`, or `fail`). A failed check returns to the
orchestrator for bounded re-planning.

## Scope audit

`subagent-scope-guard.js` snapshots active stage write sets at the beginning of
a worker burst and compares the post-burst Git diff paths with that immutable
snapshot. Expected paths are attributed to the matching stage; worker-level
attribution is added when the host exposes a worker/subagent id and the stage
contract records it. Ambiguous or out-of-scope changes exit 2. With no declared
stage contracts, the older conservative behavior remains: every newly changed
path requires review.
