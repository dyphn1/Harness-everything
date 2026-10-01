# Final-version agent rerun — 2026-10-02

This reruns the lookup comparison after the final packaging and mixed-execution guards in [PR #291](https://github.com/dyphn1/Harness-everything/pull/291). Baseline: PR #289 at `2716be9feb3e6b986c0f5da884ed4a686b95791b`. Treatment: #291 at `a49539caca3dc367d43e72997926612f091098b1`. No product files changed during or after the trials; the subsequent commit only adds evidence.

## Protocol

Four fresh native agents requested as `gpt-6-luna`, effort `xhigh`, without inherited conversation history. Run `rerun_baseline_1` and `rerun_fixed_1` together, wait for both to finish, then run `rerun_baseline_2` and `rerun_fixed_2`. Maximum concurrency: two. No worker delegated further.

Every agent ran the instrumented `probe.cjs` helper first. The helper invoked the local router on Node 24.14.1, with System One disabled and exactly this unshortened prompt:

> Explain what 'fable on sonnect' means; return only a small JSON selection record.

The shared assignment requested six fields: `requestedProfile`, `effectiveProfile`, `profileAlias`, `assignedRole`, `runtimeModel`, `runtimeEffort`. No runtime model/effort was supplied. All content reads used the helper, which prints the content and records its byte count/hash in `ledger.jsonl`. Agents read the canonical Fable entrypoint, then chose necessary references. Runtime-executed scripts were not counted as model-visible file content. Hash/stat operations were not counted either. No OS sandbox or full native-session transcript capture was used; this is instrumented cooperative evidence, not a host-enforcement claim.

All four route records have the same prompt SHA-256. Every read digest matches `frozen-inputs.json`, and all frozen product digests were rechecked after completion. No extra commands were reported. Strict JSON scoring uses the canonical profile/role values in `fable-mode/behavior-profile-matrix.json`; all six fields must match `summary.json#expectedRecord`.

## Results

| Trial | Router strategy | File-content bytes | Router stdout bytes | Canonical JSON |
|---|---|---:|---:|---|
| #289 / 1 | fable-staged | 6,580 | 1,472 | fail |
| #291 / 1 | direct-single | 3,553 | 603 | pass |
| #289 / 2 | fable-staged | 4,717 | 1,472 | fail |
| #291 / 2 | direct-single | 3,553 | 603 | pass |

Average file-content bytes: **5,648.5 → 3,553**, a **37.1% reduction** across these two paired trials. Both treatment agents read only `fable-mode/SKILL.md` and `references/profile-lookup.md`. Both baseline agents read the full model reference; baseline trial 1 additionally read the nested sonnet skill. The baseline's variable reference choice explains why this average differs from the previous preliminary comparison. The matched two-file baseline trial alone shows a 24.7% reduction.

All four agents correctly explained that `sonnect` selects reasoning behavior rather than a branded runtime model. Both baseline records used the alias in `requestedProfile` and prose in the canonical role field; both treatment records used `reasoning`, preserved `sonnect` in `profileAlias`, and used `reasoning-worker`. Runtime fields were null in every record. A failed canonical record does not mean the underlying explanation was wholly wrong.

## Limits and verification

- These are **file-content bytes**, not cache tokens, total context tokens, latency, or monetary cost. Native agents expose no provider billing/token telemetry here; cache/cost fields remain null.
- Two repetitions per arm do not establish population-level effectiveness. Both arms had access to canonical domain facts; the treatment also has a compact JSON example, so correctness improvement cannot be attributed to routing alone.
- Router stdout is retained separately and is not included in the file-content metric. Tool metadata, inherited instructions, hidden reasoning and repeated model requests are excluded.
- Requested model/effort are recorded from agent launch configuration; no independent provider identity attestation is available.
- This covers one bounded alias lookup, not every small workflow or execution stage, and does not close the broader issue #290.

Raw answers, route contracts/stdout, read ledgers and frozen input hashes are retained alongside this report. `sha256.json` protects the evidence files. Product code is unchanged from the version whose 14 required repository gates, TDD quality gate and affected skill token budget passed in the [previous verification report](../pr290-minimal-2026-10-01/README.md). No broad code-gate rerun was needed for this evidence-only update; prompt/hash/ledger/scoring checks and Git diff validation were performed.
