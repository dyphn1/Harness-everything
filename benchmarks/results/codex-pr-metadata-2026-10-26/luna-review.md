# Independent cold review: Codex PR metadata action gate

## Scope and evidence

- Repository: `/Users/daniel.chang/Desktop/Skills/Harness-codex-pr-metadata`
- Base: `b733cadec17542b9ae30aabb50c1ba3481a58d74`
- Final core SHA reviewed: `c170a96cf856295200d2d1a62c15a552c3cb2b37`
- Current repository HEAD: `a2edf4ed2204a414dd085635d2d9bf4464c59e9e` (evidence-only commit after the core review); current worktree has two additional evidence-only paths described below.
- The code path was cold-reviewed at `e160e00`, then re-reviewed through fixes `ff796c9`, `e9344de`, and `c170a96`. Final core behavior was independently exercised at `c170a96`.
- Requested model/effort: coordinator reports that the agent was routed with `model=gpt-6-luna`, `reasoning_effort=xhigh`. This agent has no host-issued runtime attestation, so actual model/effort identity remains unverified.
- Read independently: repository `AGENTS.md`, `docs/codex-action-gate.md`, code-review skill/playbook, issue [#110](https://github.com/dyphn1/Harness-everything/issues/110), issue [#122](https://github.com/dyphn1/Harness-everything/issues/122), issue [#135](https://github.com/dyphn1/Harness-everything/issues/135), complete base-to-HEAD diff, original worktree diff, and retained evidence logs/artifacts.
- Scope clauses, verbatim from the review task:
  - C1 僅 Codex 精確 update_pull_request title/body metadata-only 例外，必須實查參數；
  - C2 state/base_branch/maintainer_can_modify/unknown/mixed risk 不得豁免（包含 null）；
  - C3 actionGate.required=true 必須 gate；
  - C4 保持 mutate/gated，無 Codex permissionDecision ask/allow、Host/task scope/GitHub authorization 仍生效；
  - C5 create_pull_request 與 merge/close/delete/force-push/publish/deploy/send 既有行為不變；
  - C6 不擴其他 Host、canonical/plugin parity，hash/redacted audit provenance/executed success+failure/rejected/integrity 行為保持；
  - C7 RED→GREEN→regression 必須自行執行證明，live-host 不可從 unit/mechanism 宣稱 PASS；
  - C8 無 #376 governance 實作、#341 E1/#320 授權擴張、禁自動 merge/繞 gate。

### Paths reviewed in `base..a2edf4e`

- `CHANGELOG.md`
- `benchmarks/results/codex-pr-metadata-2026-10-26/README.md`
- `benchmarks/results/codex-pr-metadata-2026-10-26/green-final.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/green.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/original-rejection.json`
- `benchmarks/results/codex-pr-metadata-2026-10-26/red.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/review-descriptor-green.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/review-descriptor-red.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/review-family-green.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/review-family-red.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/review-hints-green.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/review-hints-red.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/luna-action-family-cross-product.js`
- `benchmarks/results/codex-pr-metadata-2026-10-26/luna-action-family-cross-product.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/luna-codex-action-gate-prehook-smoke.js`
- `benchmarks/results/codex-pr-metadata-2026-10-26/luna-codex-action-gate-prehook-smoke.log`
- `benchmarks/results/codex-pr-metadata-2026-10-26/verification.md` (current untracked evidence)
- `benchmarks/results/codex-pr-metadata-2026-10-26/luna-review.md` (current untracked copied report)
- `benchmarks/results/codex-pr-metadata-2026-10-26/live-installed-runtime-rejection.json` (current untracked installed-runtime evidence)
- `ci/action-gate.test.js`
- `ci/mechanism-2aa-codex-action-gate-policy.test.js`
- `ci/mechanism-task-git-authorization.test.js`
- `docs/codex-action-gate.md`
- `docs/platform-capabilities.md`
- `hooks/scripts/action-gate.js`
- `plugins/harness-everything/hooks/scripts/action-gate.js`

The current uncommitted worktree delta is evidence-only: README status and installed-runtime provenance, `verification.md`, the copied report, and `live-installed-runtime-rejection.json`. The README now records core PASS and the independent review, while keeping candidate live-host UNCHECKED. Its linked `luna-review.md` copy still predates this final evidence adjudication and must be refreshed from this `/tmp` report before commit. No repository files were changed by this reviewer. Temporary snapshots and scripts/logs were created under `/tmp`; the two retained Luna scripts/logs were byte-compared with those files.

## Findings and dispositions

### [BLOCKER, resolved] Earlier optional hint hid a later required hint

- **Location:** `hooks/scripts/action-gate.js:380-392` @ `e160e00d265a2b427cdf6eb25783744470b0cb81`
- **Trigger:** Codex `PreToolUse` for exact `mcp__codex_apps__github__update_pull_request`, metadata input `{repository_full_name:"acme/repo",pr_number:376,body:"fixture"}`, top-level `actionGate:{required:false}`, and `workflowPlan.actionGate:{required:true}`.
- **Behavior → impact:** `routerActionGateHint` selected the first object. The new metadata branch saw `required:false`, returned `allow`/`deferred-to-host`, and bypassed an explicitly required gate.
- **Violates:** C3.
- **Witness:** Base `b733cade` blocked this mutation; `e160e00` exited 0 with empty stdout. Positive controls: plain metadata exited 0; a single required hint exited 2. The actual Codex PreToolUse stdin entrypoint reproduced the same outcomes.
- **Evidence tier:** executed/reproduced under Node 24.22.1.
- **Correction / regression:** `ff796c9` now prioritizes any supported `required:true` hint. The RED test from `1e77c26` failed 9 assertions on `e160e00`; the GREEN test passed. The retained test covers all four supported hint envelopes with conflicting optional hints.
- **Disposition:** resolved at `ff796c9`, rechecked at `c170a96`.

### [MAJOR, resolved] Read/unknown action descriptors bypassed required gating and mixed-risk checks

- **Location:** `hooks/scripts/action-gate.js:156-159` @ `e160e00d265a2b427cdf6eb25783744470b0cb81`
- **Trigger:** exact Codex PR update with `tool_input` containing `state:"closed"` and `action_descriptor:{action:"read"}`, plus `workflowPlan.actionGate.required:true`.
- **Behavior → impact:** `structuredRule` returned early for a descriptor classified `safe`, before checking the required hint or the metadata allowlist. The hook returned allow with no audit; a mixed high-risk input escaped the intended metadata-only check.
- **Violates:** C2 and C3.
- **Witness:** Starting state: this behavior existed at base. Expected: block because `state` is an additional high-risk field and the workflow requires a gate. Actual: `allow`, exit 0, no decision record. Positive controls: replacing `read` with `delete` or removing the explicit descriptor blocks with exit 2.
- **Evidence tier:** executed across base, `e160e00`, and `ff796c9`; actual external reachability of an `action_descriptor` parameter depends on the active tool schema/adapter and was not established. The Codex PR connector schema recorded in the evidence does not list that input field.
- **Correction / regression:** `e9344de` normalizes read/unknown descriptor actions to `mutate` for exact Codex PR-update operations before the early safe branch. The RED test from `06a66c2` failed 11 assertions on `ff796c9`; GREEN passed. Final action/family cross-product and stdin smoke confirm `mutate`/`gated` audit provenance and rejection of mixed fields.
- **Disposition:** resolved for exact Codex PR update at `e9344de`, rechecked at `c170a96`. The pre-existing behavior for unrelated tools/hosts was not changed.

### [MAJOR, resolved] Explicit shell family disguised an MCP PR update

- **Location:** `hooks/scripts/action-gate.js:156-159` @ `e9344de` (same early shell-family return in `e160e00`)
- **Trigger:** exact Codex PR update with `action_descriptor:{toolFamily:"shell",action:"delete"}` and otherwise metadata-only arguments.
- **Behavior → impact:** explicit descriptor family overrode the actual `mcp__...` tool identity; `structuredRule` returned at its shell branch without gating the `delete` action.
- **Violates:** C2, C3 and C4.
- **Witness:** Expected: a `delete` descriptor on a GitHub MCP update must be blocked and audited as MCP. Actual before the family fix: `allow`, exit 0, no record. Positive control: the same descriptor with `toolFamily:"mcp"` blocked with exit 2. The direct mechanism case was reproduced at the intermediate `e9344de` state.
- **Evidence tier:** executed at mechanism level; external reachability is subject to the same tool-schema boundary above.
- **Correction / regression:** `c170a96` derives the family from exact Codex PR tool identity, ignores a descriptor's family downgrade, and preserves `delete`/`publish`/`deploy`/`send` classifications. The RED test from `16f5e20` failed 14 assertions on `e9344de`; GREEN passed.
- **Disposition:** resolved at `c170a96`.

### [MINOR, resolved in README; copied report refresh pending] README review status was stale

- **Location:** `benchmarks/results/codex-pr-metadata-2026-10-26/README.md` (uncommitted worktree delta)
- **Trigger:** The report and independent checks are now complete, while the README still says `Independent review | Pending Luna xhigh cold review`.
- **Behavior → impact:** The evidence index understates completed review status.
- **Violates:** C7 evidence-record accuracy.
- **Witness:** Starting state/input: README pending row plus completed `/tmp/luna-pr-metadata-review.md`. Expected: row updated to review result. Actual: pending text remains.
- **Evidence tier:** source-traced.
- **Minimal correction:** Update the status row with the final core review result and retain the separate full-regression/live-host boundaries.
- **Regression:** Negative: status remains pending after report is accepted; positive control: the same README correctly labels candidate live-host as UNCHECKED.
- **Disposition:** resolved in the current README, which now links the core PASS result. Refresh the copied `luna-review.md` so it does not retain the old pending statement; this is evidence-copy synchronization only, not a runtime blocker.

## Independent verification

All local Node commands below explicitly used `/Users/daniel.chang/.nvm/versions/node/v24.22.1/bin` (`v24.22.1`).

| Check | Result / evidence |
| --- | --- |
| `node ci/action-gate.test.js` at `c170a96` | PASS, 0 failures |
| `node ci/mechanism-2aa-codex-action-gate-policy.test.js` at `c170a96` | PASS |
| `node ci/mechanism-task-git-authorization.test.js` at `c170a96` | PASS |
| `npm run test:plugin:openai` at `c170a96` | PASS; canonical/package parity and runtime checks |
| `npm run test:consistency` at `e160e00`; final `verify:all` at `c170a96` | PASS in both reviewed evidence runs |
| `npm run test:platform:compatibility` at `e160e00`; final `verify:all` at `c170a96` | PASS in both reviewed evidence runs |
| `npm run test:plugin:submission` at `e160e00`; final `verify:all` at `c170a96` | PASS in both reviewed evidence runs |
| Original RED: base archive `b733cade` + `db6c29b:ci/action-gate.test.js` | 12 expected failures; preceding baseline/dependency controls passed |
| Required-hint RED: `e160e00` archive + `1e77c26:ci/action-gate.test.js` | 9 expected failures |
| Descriptor RED: `ff796c9` archive + `06a66c2:ci/action-gate.test.js` | 11 expected failures |
| Family RED: `e9344de` archive + `16f5e20:ci/action-gate.test.js` | 14 expected failures |
| Final GREEN: `node ci/action-gate.test.js` at `c170a96` | PASS, 0 failures |
| Independent action × family × descriptor-envelope × required-hint/unsafe-field cross-product | PASS: 2,709 cases, 4,729 assertions, 0 failures; `/tmp/luna-action-family-cross-product-final.log` |
| Independent Codex PreToolUse stdin smoke | PASS: 7 subprocess cases; `/tmp/luna-codex-action-gate-prehook-smoke-final.log` |
| Base-versus-candidate controls: create, merge, close, delete, force-push, publish, deploy, send | Same outcomes; create remained host-deferred/mutate, all risky controls blocked |
| Original rejection hash provenance | PASS: parsed the cited transcript `CommandExecution.aggregated_output` (1,840 chars), reconstructed sorted compact JSON for repository/pr/body, SHA-256 matched audit `b9bda711…c87b` |
| Full `npm run verify:all` at final core SHA | PASS: exit 0, 13 PASS / 0 FAIL / 3 UNCHECKED (local Node 22 lanes); log SHA-256 `630159501b19d1d0178683262f0bfe7c0ec9cacb29a336057bb95094481129f4` |
| Candidate live-host behavior | UNCHECKED. The retained `live-installed-runtime-rejection.json` is an old installed runtime rejection, not candidate evidence. |

## Contract review summary

- C1/C2: exact Codex operation plus strict parameter allowlist; additional fields including null remain gated; metadata descriptor stays `mutate`/`gated`; high-risk action descriptors remain gated.
- C3: any `required:true` hint across supported envelopes wins; audit preserves the required hint.
- C4: the prehook emits no Codex `permissionDecision` allow/ask for the deferred metadata call. Host task scope, Codex permissions, and GitHub authorization remain the execution authorities.
- C5: create-PR behavior and risky controls matched the base; regression tests retain the explicit required-gate case.
- C6: canonical/plugin byte parity, redacted audit, exact payload hash, execution success/failure, rejection, and integrity behavior passed mechanism tests. No other Host was widened.
- C7: RED/GREEN was independently reproduced at each correction boundary; no package/mechanism result is called a candidate live-host PASS.
- C8: reviewed changes contain no #376 governance implementation, #341 E1 credit, #320 authorization expansion, auto-merge, or gate bypass.

## Final recommendation

No open runtime/code blocker remains at `c170a96`; the three code findings were fixed and rechecked. The final Node 24 full suite passed, with only the three explicit Node 22 lanes UNCHECKED. Candidate live-host behavior remains UNCHECKED. The README review-status minor is fixed in the current README; refresh the copied report before committing the evidence package.

## Final evidence-only adjudication

- Raw log `/tmp/pr-metadata-verify-final.log`: independently hashed to `630159501b19d1d0178683262f0bfe7c0ec9cacb29a336057bb95094481129f4` (matches `verification.md`). Header pins core `c170a96cf856295200d2d1a62c15a552c3cb2b37`, Node `v24.22.1`, Darwin, default full gate set. Process exit is `0`.
- Summary verified from the raw log: 13 PASS, 0 FAIL, 3 UNCHECKED. The three unchecked lanes are Node 22 self-regression smoke, installer roundtrip smoke, and `npm ci` install; optional Waza readiness passed.
- `verification.md` matches the raw log hash, header, per-gate results, and summary.
- Current README closes the earlier pending-review row, reports the full-suite summary, preserves the `gpt-6-luna`/`xhigh` routing request with no host-issued runtime attestation, and keeps candidate live-host status UNCHECKED. It does not claim final-head CI is all green; its PR workflow reference is explicitly the initial run and says final-head status must be checked separately.
- No runtime or plugin path changed after frozen core `c170a96`; the post-core commit `a2edf4e` and worktree delta are evidence-only. The old installed runtime rejection audit points to installed runtime `0.42.0-f51078676b56`; it is not candidate live proof.
- Candidate live-host execution remains UNCHECKED. No new destructive remote operation was attempted by this reviewer.
- The copied `luna-review.md` currently contains the pre-final pending text and must be recopied from this report before the evidence commit.

Skipped: no Node 22 lane rerun and no candidate live-host execution. Risk: those evidence boundaries remain unverified; final core Node 24 gates passed.

STATUS: DONE
