# F2 paired task: F1 carrier vs F2 carrier (2026-10-22)

One small, real doc edit, run once per arm. The arms differ only in the Harness tree under test. This run shows whether the carrier was followed. It is **not** evidence of writing quality or of #341 E1.

## Setup

| Item | F1 arm | F2 arm |
|---|---|---|
| Tree | `feat/325-f1-doc-path` @ `1d70dd3` (rsync copy, no `.git`, no `node_modules`) | `feat/325-f2-doc-craft` working tree after F2-I2 (same copy method) |
| Agent | OpenCode, GLM-5.3-Flash, fresh session (`/new`) | same |
| Task text | [arm-f1-task.md](arm-f1-task.md) | [arm-f2-task.md](arm-f2-task.md): byte-identical apart from the workspace path (checked with `diff`) |
| Task | Clarify the opening paragraph of governed `docs/doc-workflow-reconciliation.md`; keep links, frontmatter and claims; run the governed-doc check the guidance names | same |

## Results

| Measure | F1 arm | F2 arm |
|---|---|---|
| Carrier path read | `SKILL.md` → `doc-check.md`. It skipped `triage-and-tiers.md`, although F1's tree has the Governed-doc pointer there, so the agent found `doc-check.md` some other way. The report doesn't say how. | `SKILL.md` → `triage-and-tiers.md` → `doc-check.md` → `_shared/writing-craft.md` |
| Shared craft read | no (does not exist in F1) | yes, `writing-craft.md` |
| Check run | yes, exit 0, 10 links, 0 broken | yes, exit 0, 10 links, 0 broken |
| `prose-share` reminder | n/a (no field in F1) | 1, SHOULD, 559/721 (77.5%); acknowledged, no restructure (task forbade it) |
| Guidance the agent cited for its edit | `doc-check.md` only | `writing-craft.md` "one idea per sentence", plus `doc-check.md` |
| Files changed | only the target doc ([arm-f1.diff](arm-f1.diff)) | only the target doc ([arm-f2.diff](arm-f2.diff)) |
| Coordinator re-check on the edited arm | exit 0 | exit 0 |

- **executed:** the arm diffs, the re-checks and the file-change scope were verified by the coordinator, not only taken from the agent reports.
- **source-traced:** the "files read" lists are the agents' self-reports. No host-level read trace was captured.
- **inconclusive:** n = 1 per arm, with one model. Whether the F2 paragraph is *better* has not been judged independently. The reminder proves only that the advice reached the agent.

## Comparison with the F1 baseline

The F1 command behaviour is unchanged. The F2 suite runs F1's fixtures for exit equivalence, and the reviewer found the exit code identical in 12/12 lanes. F2 adds exactly one thing on the real path: the agent reaches and cites shared craft, and receives the advisory `reminders` output.
