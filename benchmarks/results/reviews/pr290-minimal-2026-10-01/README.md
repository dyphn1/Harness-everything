# PR #289 → bounded Fable profile lookup

Base: `2716be9feb3e6b986c0f5da884ed4a686b95791b` (PR #289).
Related issue: [#290](https://github.com/dyphn1/Harness-everything/issues/290).

## Change and evidence boundary

The router previously treated an explanation of `fable on sonnect` as a Tier 3 `fable-staged` execution request. The fix chooses a bounded `direct-single` lookup before recommending references, preserves the profile alias, and omits unrelated keyword guides/dynamic recommendations for that operation. The single public Fable entrypoint dispatches to a compact profile reference. Mixed execution, explicit topology, and macro scope retain their existing workflow obligations.

This is a conservative supported-prompt classifier, not a general natural-language intent parser. It does not optimize every bounded stage or every workflow. Reference selection is an instruction contract, not a host-enforced file-read boundary. Addresses the reproducible profile-lookup portion of #290; does not establish that the broader issue is closed.

## Four Luna/xhigh agents, two at a time

Four native subagents were explicitly requested as `gpt-6-luna` with `xhigh`, without inherited conversation history. Batch 1 ran `lookup_baseline_1` and `lookup_fixed_1`; after both finished, batch 2 ran `lookup_baseline_2` and `lookup_fixed_2`. No comparison worker spawned another worker. The native tool confirmed the requested configurations; it does not expose provider billing or independently reported runtime identity.

Both arms had local canonical domain knowledge and the same assignment: explain `fable on sonnect`, return profile/alias/role/runtime fields, with no supplied runtime and no execution/delegation. Agents ran the local router, read the Fable entrypoint, and chose necessary references. All four reports are under `agents/`.

| Observation | #289 | Fix |
|---|---|---|
| Router strategy, both repetitions | fable-staged | direct-single |
| Canonical `requestedProfile`, both repetitions | sonnect (alias in canonical field) | reasoning |
| `profileAlias`, both repetitions | sonnect | sonnect |
| Runtime fields, both repetitions | null / null | null / null |
| Second-batch printed file content | 4,717 bytes | 3,571 bytes |
| Second-batch reference content | 2,813 bytes | 1,377 bytes |
| Second-batch unrelated guide recommendations | 9 | 0 |

The second batch loaded 24.3% fewer **file-content bytes**, and its reference was about 51% smaller. These are not token, cache-read, total-context, latency, or monetary measurements. Executing a router script does not put that script's source into model context, so runtime file sizes are excluded. Hash/stat-only reads are excluded too. Tool-call instrumentation was batched differently; its counts do not establish a workflow efficiency improvement.

Batch 1 is exploratory: the fixed skill was compressed during that session and reread. It is excluded from byte comparisons. Despite an exact-string instruction, both batch-2 agents shortened the routed prompt to `Explain what 'fable on sonnect' means`; both used the same shortened version. Final packaging then qualified reference paths, clarified the contract table, restored the required Deep dive pointer, and repaired a Markdown reference link. Final mixed-execution guards were also strengthened after comparison. These changes are covered by deterministic tests, but the native trials are not a rerun of the final package. Exact compared content and final content are retained losslessly in `snapshots.tar.gz`, with member hashes in `snapshots-sha256.json`.

The compact guide includes a canonical JSON example, so answer improvement cannot be attributed to routing alone. Two repetitions per arm are qualitative evidence; there is no statistical effectiveness or cost claim. The previous 3.78× cache-read observation came from a different, flawed OpenCode experiment; these trials neither reproduce nor validate that multiplier.

## Verification

`verification/summary.json` records the final required 14 repository gates on Node 24.14.1. RED/GREEN logs cover supported English/Chinese aliases, quoted invocation explanations, no unrelated guides, deterministic contracts, actual/mixed execution and macro/topology boundaries. The integration evidence additionally exercises identical subprocess runs, schema validity, unknown-alias fallback, contract emission and cleanup. Reproduce it from the repository root:

```sh
node benchmarks/results/reviews/pr290-minimal-2026-10-01/verification/reproduce-tdd.js
npm run tdd:quality -- benchmarks/results/reviews/pr290-minimal-2026-10-01/verification/tdd-evidence.json --output benchmarks/results/reviews/pr290-minimal-2026-10-01/verification/tdd-quality-report.json
```

All 53 raw test/Waza logs, including initial failures and intermediate passes, are losslessly archived in `verification/logs.tar.gz`; `verification/logs-sha256.json` verifies each member. Waza readiness/spec/token outputs are retained. The affected canonical entrypoint is under 500 tokens. Recursive `waza tokens check` also discovers the deliberately over-budget negative fixture (`over-budget-skill`, 855 tokens); it is not a canonical skill regression. Raw Waza orphan advisories reflect placeholder links; the repository's reference adapter checks their actual reachable closure. No live-host enforcement or production effectiveness claim is made.
