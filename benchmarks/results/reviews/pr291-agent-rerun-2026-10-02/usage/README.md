# Complete usage, cost equivalents and execution paths

Audit date: 2026-10-02, Asia/Taipei. This supplements the [frozen final-version comparison](../README.md) and corrects its initial statement that token usage was unavailable. The native collaboration tool did not return usage, but the local Codex rollouts contain complete `token_usage_record` events. No new model trials were run for this audit.

## Provenance and accounting

`audit.py` reads only the eight named comparison threads and two associated completed parent turns from local read-only Codex SQLite/rollout files. `audit.json` exports sanitized per-request token counters, action labels, timestamps, model/effort and source-record hashes. It does not export conversation, reasoning text, credentials, account IDs, or raw diagnostic log bodies.

Each response ID is unique. Per-request `usage` is summed once, then checked against the last cumulative thread counter (children) or scoped turn counter (parents). Cumulative snapshots and their duplicate `event_msg/token_count` events are never summed. Every record satisfies `total = input + output`; reasoning is a subset of output. Local turn contexts confirm `gpt-6-luna` / `xhigh` for all eight children. Local request logs report the `default` tier for the final four children.

Published Standard rates, USD per million tokens: Luna uncached input **0.10**, cached input **0.01**, cache writes **0.125**, output **0.50**. Sol 6.1 uses **2.00 / 0.10 / 2.50 / 10.00** respectively. Sources: [Luna model pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [API pricing](https://developers.openai.com/api/docs/pricing?tab=suite), [reasoning billing and usage example](https://developers.openai.com/api/docs/guides/reasoning).

```text
uncached = input − cached input − cache writes
USD equivalent = (uncached × input rate + cached × cached rate
                  + cache writes × write rate + output × output rate) / 1,000,000
```

Cache writes are zero in every audited request. Reasoning is not charged again on top of output. The [Codex Standard credit rate card](https://learn.chatgpt.com/docs/pricing) gives Luna **2.5 / 0.25 / 12.5** credits per million uncached/cached/output tokens; Sol 6.1 gives **50 / 2.5 / 250**. Credit equivalents are included in `audit.json`.

**These are API/credit equivalents, not invoiced charges.** The logs have tokens and shared subscription-limit snapshots, but no per-session settled dollar charge. Included subscription usage is not determined by the credit rate alone. Integer, account-wide usage percentages overlap concurrent parent/child activity and cannot attribute a quota percentage to either arm. This report does not claim a reduction in the subscription bill.

## Final four agents: every request included

| Trial | Model requests | Tool calls | Uncached input | Cached input | Output (reasoning subset) | Total tokens | Elapsed seconds | Standard API equivalent USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| #289 / 1 | 6 | 5 | 9,973 | 144,896 | 2,626 (1,986) | 157,495 | 59.375 | 0.00375926 |
| #291 / 1 | 5 | 4 | 6,406 | 117,504 | 774 (313) | 124,684 | 23.015 | 0.00220264 |
| #289 / 2 | 5 | 4 | 8,414 | 118,528 | 2,048 (1,558) | 128,990 | 45.906 | 0.00305068 |
| #291 / 2 | 5 | 4 | 6,491 | 117,504 | 897 (495) | 124,892 | 25.759 | 0.00227264 |

| Mean per trial | #289 | #291 | Reduction |
|---|---:|---:|---:|
| Total input | 140,905.5 | 123,952.5 | 12.0% |
| Uncached input | 9,193.5 | 6,448.5 | 29.9% |
| Cached input | 131,712 | 117,504 | 10.8% |
| Output, including reasoning | 2,337 | 835.5 | 64.2% |
| Reasoning subset | 1,772 | 404 | 77.2% |
| Total tokens | 143,242.5 | 124,788 | 12.9% |
| Standard API equivalent USD | 0.00340497 | 0.00223764 | **34.3%** |
| Standard credit equivalent | 0.08512425 | 0.055941 | 34.3% |
| Elapsed seconds | 52.6405 | 24.387 | 53.7% |

Paired cost reductions are 41.4% and 25.5%; the ratio of mean baseline to mean treatment cost is **1.52×**, not 4×. The elapsed-time result includes inference and local tools, is sensitive to runtime variation, and is not a stable latency claim from two trials.

Of the average US$0.00116733 saving, output accounts for **64.3%**, uncached input **23.5%**, and cache reads **12.2%**. Fewer file bytes therefore do not imply the same percentage reduction in cache tokens or dollars. Both arms already started with about **23.8K input tokens**, including **22,272 cached tokens**, before their first tool ran; fixed host/tool/instruction context remains. The new branch controls additional workflow references, not that entire common context.

## Selected topology versus actual execution

| Surface | #289 | #291 |
|---|---|---|
| Tier | tier3 | tier1 |
| Selected workflow | fable-staged | direct-single |
| Profile selection in router contract | reasoning, alias sonnect | reasoning, alias sonnect |
| Verification prescribed by contract | independent cold-verifier | verify-before-claim |
| Extra prescribed obligations | stage contracts, cold verification, isolation before mutation | none of those macro obligations |
| Suggested skills | using-git-worktrees, fable-mode, fable-discipline, verification-loop | none |
| Unrelated keyword-guide recommendations | 9 | 0 |
| Actual child delegation / stage state | 0 / 0 | 0 / 0 |
| Actual cold reviewer / isolated mutation | not executed / no mutation | not executed / no mutation |

The controlled assignment explicitly prohibited execution and delegation. **The baseline selected staged topology but did not execute a complete staged workflow.** Thus the observed savings come from the lookup's reference choice and model responses; they do not measure eliminated worker launches, worktrees or cold-review sessions. That enforcement/behavior gap remains visible rather than being presented as a proven full-Fable cost saving.

Actual model-visible content paths, in order:

```text
#289 trial 1:
route → fable-mode/SKILL.md → fable-mode/fable-sonnet/SKILL.md
      → fable-mode/references/model-matrix.md → write report → final answer

#289 trial 2:
route → fable-mode/SKILL.md → fable-mode/references/model-matrix.md
      → write report → final answer

#291 both trials:
route → fable-mode/SKILL.md → fable-mode/references/profile-lookup.md
      → write report → final answer
```

`audit.json#latestTrials.requests` associates each model response with its subsequent tool/action and usage. A response deciding to read a file precedes that file's tool result; its token cost is not falsely attributed entirely to that file. Executed router source is excluded from model-visible file bytes.

## Entire operation, including the parent

The parent turn that launched, recorded, validated and published the final rerun used **GPT-6.1 Sol / medium**, 13 model requests, **1,455,905 input** (**1,436,288 cached**) and **9,336 output** tokens. Its 1,465,241 total tokens are separate from child usage; response IDs and thread IDs prevent double counting.

| Completed operation scope | Child API equivalent USD | Parent API equivalent USD | Total API equivalent USD |
|---|---:|---:|---:|
| Final rerun + report/publication | 0.01128522 | 0.27622280 | **0.28750802** |
| Earlier implementation + verification + exploratory comparison | 0.02550562 | 0.99971680 | **1.02522242** |
| Both operations | 0.03679084 | 1.27593960 | **1.31273044** |

For the final rerun, the parent accounts for **96.1%** of the API-equivalent cost. This shared preparation/report/publication overhead is not attributed to baseline or treatment. Long existing parent context and a different model/rate dominate the complete experiment cost; minimizing the child lookup alone cannot remove that overhead.

The earlier implementation scope includes source changes, repeated verification, initial trials and PR creation; it is not a pure test-only cost. Its four trial records are retained in `audit.json#initialExploratoryTrials`, including the draft-version rereads. These exploratory trials are not pooled with the frozen final comparison. Earlier PR review/OpenCode experiments and this ongoing after-the-fact audit turn are excluded explicitly; this is not a lifetime session bill.

## Effectiveness and remaining uncertainty

- The same full prompt selected direct-single twice after the fix, with no product-input changes during testing.
- Strict canonical six-field JSON improved **0/2 → 2/2**. All four agents understood the alias's meaning; the baseline failures were canonical-field normalization/prose enum values, not wholly incorrect explanations.
- Mean model-visible file bytes fell **37.1%**, and both fixed reads followed the compact route. Complete child tokens fell **12.9%**; Standard API-equivalent cost fell **34.3%**.
- The compact guide supplies an explicit JSON example, so quality/cost changes cannot be causally attributed to routing alone. Two paired trials do not establish population-level effectiveness or a general 4× cache claim.
- Macro/mixed-execution obligations remain covered by the deterministic regression suite. This lookup probe does not demonstrate live-host enforcement of all those obligations.

Reproduce the audit on the original host, without running model calls:

```sh
python3 benchmarks/results/reviews/pr291-agent-rerun-2026-10-02/usage/audit.py
```

On another host, use the exported `audit.json` to independently recompute token and price arithmetic. Source rollouts remain private local evidence; only sanitized usage is published. Product code did not change for this audit.
