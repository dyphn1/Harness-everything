# F3 paired task: F2 carrier vs F3 carrier, stale derived view (2026-10-22)

The task is a metadata change that makes a declared derived view stale. Each arm ran once. The two arms differ only in the Harness tree under test. This shows whether the regenerate-equals loop was followed. It is **not** evidence of quality or of #341 E1.

## Setup

| Item | F2 arm | F3 arm |
|---|---|---|
| Tree | `feat/325-f2-doc-craft` @ `3413ece` (rsync copy, no `.git`, no `node_modules`) | F3 working tree after F3-I2 and the generated index |
| Start state | F3's `project-docs.json` (with the `derived` declaration) and F3's current `docs/governed-index.md` copied in, so both arms have the same declaration and the same current view (checked with `diff`) | same |
| Agent | OpenCode, GLM-5.3-Flash, fresh session (`/new`) | same |
| Task | [arm-f2-task.md](arm-f2-task.md) and [arm-f3-task.md](arm-f3-task.md). Byte-identical apart from the workspace path. Mark `docs/architecture.md` deprecated, keep dependents consistent, and run any declared command (authorized). | same |

## Results

| Measure | F2 arm | F3 arm |
|---|---|---|
| Outcome | `status: deprecated`; index regenerated | `status: deprecated`; index regenerated |
| Final index | byte-identical to the F3 arm | byte-identical to the F2 arm |
| Coordinator re-check (`compare-derived` from a fresh regeneration) | `equal` | `equal` |
| Files changed | `architecture.md`, `governed-index.md` | `architecture.md`, `governed-index.md` |
| Carrier path read | `SKILL.md` → `document-lifecycle.md` → config → index (no `doc-check.md`) | `SKILL.md` → `triage-and-tiers.md` → `doc-check.md` → config → index |
| Doc check run | no | yes, before and after the change |
| Stale view detected **before** replacement | no record | `check` listed the view as `unverified`, then `compare-derived` returned `stale` (exit 1) |
| Regenerate-equals evidence | none; the generator output was written directly | `compare-derived` returned `equal` (exit 0) after the write |
| Off-task commands | `verify-gate.js` and a `2ax` test run (environment failure unrelated to the task) | none |

- **executed:** the coordinator verified both outcomes from disk: the diffs, the byte-identical indexes, and an independent regenerate-and-compare.
- **source-traced:** the read lists and command lists are the agents' self-reports.
- **inconclusive:** n = 1 per arm. The F2 agent reached the right result by reading the config. F3 changes the **evidence**, giving a recorded stale→equal comparison, and does not change the outcome in this run.

## Comparison with F1/F2

`check` keeps its F2 exit codes and reminders. F3 adds only the `unverified` coverage entries and the separate, pure `compare-derived` command. Discovery never executes the generator: D1 of the F3 suite uses a sentinel command to verify this.
