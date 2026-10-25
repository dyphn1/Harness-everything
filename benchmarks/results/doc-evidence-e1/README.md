# #341 E1 live observation record — 2026-10-25

**Status: retained observations only.** The independent cold reviewer (Luna xhigh) adjudicated O1/O2 as non-qualifying, confirmed the withholding was correct, and found no false MUST PASS or false rejection. E1 remains OPEN/UNCHECKED; no formal GO/REVISE/NO-GO decision is made here.

## Task and correction

The first Claude Code session corrected the current status wording in [doc-workflow-reconciliation.md](../../../docs/doc-workflow-reconciliation.md) after comparing it with the retained [OpenCode D1/D2 record](../live-host/opencode-d1-d2-2026-10-25/README.md). A later host reviewer found three remaining current-status copies that conflicted with the correction. The owner authorized a narrow consistency edit to those copies in the same reference and [document-lifecycle.md](../../../docs/document-lifecycle.md). The edit preserved the original S2 entry condition: E1 observation begins only after a creditable S2.

After the host observations, a cold source review also found that the lifecycle heading labeled the whole table as a 2026-10-20 status even though the Phase 3b/3c rows had advanced. The heading now identifies the original checkpoint and the two updated rows. The Phase 3c row records **H1 preparation only** from #373; full H1–H4 and paired-task evaluation remain pending. These are source-traced publication corrections, not E1 runtime evidence.

No source or test code changed. The lifecycle contract is not in `.agents/harness-everything/project-docs.json`; it remains outside the current doc-check governed set.

## Expected and actual decisions

| Case | Expected | Actual | Interpretation |
|---|---|---|---|
| Initial single-path `doc-lint` | Pass (initial prediction) | Partial: no domains are declared, so bare `<DOMAIN>-NNN` references are unchecked | The initial prediction was wrong; later runs expected `partial`. This is a coverage limit, not a false rejection. |
| Single-path `link-check` | Pass | Pass: 11 links checked, 0 broken | Matches the initial expectation. |
| Final `doc-lint` with both changed paths | Partial | Partial: no domains are declared | No doc-lint credit. |
| Final `link-check` with both changed paths | Partial, because `document-lifecycle.md` is not governed | Partial: 11 links checked, 0 broken; lifecycle file skipped as not governed | The existing config does not establish link coverage for the second path. No config expansion was made. |
| Current E1 status review | Approve only if current status copies agree, D1/D2 remain non-qualifying, the S2 gate remains, and no GO/benefit is claimed | A read-only host reviewer approved the O2 observed candidate hashes. The cold reviewer found the later H1 row/date-heading inconsistencies and authorized their correction; the final publication hash is recorded separately. The runtime report retained reviewer/scope/artifact conflict diagnostics, so it accepted no review reference. | Content approval is recorded; runtime quality-review credit is not. |
| Verification step with partial coverage | Withhold PASS | Exit 2: `document verification pending: S1 grants no document credit`; `pilotCredit=false` | Expected fail-closed outcome. No false MUST PASS was observed. |

## Workflow and host evidence

- O1 was a real body-only edit and direct registered `doc-check` run, but the host routed it as Tier 1. No typed workflow or pilot report was observed, so O1 is exposure only.
- O2 used a Tier 2 `iterative-single` workflow on the pinned `25c4a8478d5617d1e803940951876bb3ae1ecb37` baseline. It remains `running`: `req-review` has a stale recorded digest and `req-verify` is pending.
- The runtime report in [pilot-report.json](pilot-report.json) is `reportOrigin: runtime`, `pilotCredit: false`, `pilotStatus: unresolved`, with no credited capabilities or accepted references. Diagnostics include partial coverage, missing result/path coverage, reviewer independence, scope, artifact, and event conflicts. This report records the observed diagnostics; it does not establish their root cause.
- Host: Claude Code 2.1.310, `claude-sonnet-5-5`, first-party provider, macOS 26.6.2 arm64. The staged Claude plugin was version 0.42.0 with 1,754 tracked files from the pinned baseline.
- The per-session hook wrapper recorded 8 raw hook payloads for O1 and 53 for O2, with no duplicate event/tool keys. The cold reviewer independently matched these counts and artifact hashes and found no credentials in retained public artifacts. Raw host transcripts, hook payloads, and state journals remain private in `/tmp/harness-e1-2026-10-25`; `evidence.json` records their hashes. The O2 reviewer saw `document-lifecycle.md` at `503ef6d2…`; the final publication bytes are `d66f5731…` after the separately source-traced Phase 3c update.

## Exact checks, cost, and next item

The checker commands captured in the host journals were:

```sh
node "/tmp/harness-e1-2026-10-25/plugin/harness-everything/scripts/doc-check.js" check --workspace "/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/341-e1-decision-evidence" --config .agents/harness-everything/project-docs.json --changed-path docs/doc-workflow-reconciliation.md

node "/tmp/harness-e1-2026-10-25/plugin/harness-everything/scripts/doc-check.js" check --workspace "/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/341-e1-decision-evidence" --config .agents/harness-everything/project-docs.json --changed-path docs/doc-workflow-reconciliation.md --changed-path docs/document-lifecycle.md
```

The plugin was staged with `node scripts/stage-claude-plugin.js /tmp/harness-e1-2026-10-25/plugin`. Claude was run with the pilot switch ON, per-run `HARNESS_STATE_HOME`, the staged plugin, per-session capture settings, and a reviewer restricted to `Read`/`Grep`. The raw stream and exact prompts are retained locally by hash; no global user settings or credentials were changed.

- O1 host result: 18.139 s, 6 turns, 1,815 output tokens, $0.126 reported cost, 5 unique journal tool-use IDs, 1 edit call.
- O2 resumed session: latest result 37.486 s; host reports 21,297 session output tokens and $1.058 cumulative session cost; journal has 26 unique tool-use IDs and 4 failed tool calls. These are host-reported values, not end-to-end wall time.
- Exact coordinator intervention count and total end-to-end wall time were not measured. Final correction scope is four E1 status rows, one separate Phase 3c row, and one historical-checkpoint heading clarification; no source code or tests were added.
- Initial `verify:all -- --fast` was interrupted after the missing-worktree-`node_modules` setup failure. `npm ci --ignore-scripts` then installed 106 packages without a lockfile change; npm also reported one moderate advisory. The coordinator owns final `verify:all`; this worker did not run it.
- Coordinator final `npm run verify:all` on Node 24.22.1 completed **13 PASS / 0 FAIL / 3 UNCHECKED**; optional Waza readiness passed. The three unchecked items are the Node 22 self-regression smoke, installer roundtrip, and `npm ci` lane (the CI runtime-floor job covers Node 22). Windows/remote CI was not run. Log: `LOCAL_ONLY:/tmp/harness-e1-final-verification-node24.log`, SHA-256 `cb2c783c0913a72a39c7b03aa179dc6317d90439ad49bdfa15a143ee96e9a530`.

**Smallest next item:** a future qualifying task needs complete `doc-lint` coverage, a changed-path set fully within truthful configured governance for `link-check`, and a fresh independent reviewer principal from the start. No domain or governance expansion is inferred here; the owner decides whether project-domain configuration should be added.

## Provider fallback context (non-qualifying)

The owner requested a disposition of the fallback paths. The read-only provider diagnostic reports:

- OpenCode's `glm-5.3-flash-free` primary had exhausted its free usage limit.
- OpenCode's selected `openai/gpt-6-luna#xhigh` route rejected the configured credential and returned no model response. The cause beyond that rejection is unknown; no key text is retained here and no credential was changed.
- A separate NVIDIA `glm-5.3` probe produced no output within a 58-second cap while another NVIDIA call was already active. The cause is unknown; this does not establish NVIDIA unavailability.
- The native Codex `gpt-5.6-luna` xhigh read-only worker probe returned `READY` (12,665 reported tokens). This establishes worker-path availability only; it is not the Claude subject or E1 evidence.
- Claude Code 2.1.310 was authenticated and used as the experimental subject for O1/O2. Those observations remain non-qualifying for the reasons above.

All fallback probes are non-qualifying and are kept as operational context, not behavior or E1 outcome evidence. The sanitized provider diagnostic hash is `b918e70720a2d2d3ec77ddc343fa411e332e328202da2ff3bd1d145c235d320d` (`LOCAL_ONLY:/tmp/harness-provider-diagnostic.md`).

## Qualification

`qualifyingE1Cycles` is recorded as **0**. O1 lacked a typed workflow and runtime report. O2 did not complete and received no runtime document credit. The cold reviewer marks the evidence layer as source-traced correspondence against the raw host records; the cycles remain non-qualifying. The #341 Phase 0D acceptance target—2–3 genuine development/review cycles with sufficient case mix—remains unsatisfied; this record closes no E1 acceptance criterion. It makes no E1 GO/REVISE/NO-GO or #320 promotion claim; #325 H1–H4 and paired-task evidence remain separate.

The first run's mistaken `doc-lint=pass` prediction, the later corrected `partial` expectation, both reviewer outcomes, and the verification refusal are retained in `evidence.json` and `pilot-report.json`. The current reviewer approval is not treated as a qualifying runtime review because the runtime report accepted no quality-review reference.
