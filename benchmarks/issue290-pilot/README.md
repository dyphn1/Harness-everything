# Issue #290 pilot report: active-step reference disclosure

**Status:** pilot only. Issue #290 stays open. This report makes no benefit claim, no quality non-inferiority claim, and no formal efficacy claim.

Question (from [protocol.json](protocol.json)): does active-step reference disclosure reduce observed reference reads and execution overhead without losing required workflow behavior?

## Conclusion

1. **Descriptive lookup observation under an unverified instructed-eager intervention.** The corrected parent-stream classifier attributes 37,914 reference bytes to A and 7,142 to B per model (two paired episodes; −81.16%). A was instructed to read eagerly; that intervention was not structurally verified. Both arms received experiment text. These numbers do not establish a causal effect or normal-product savings, and measure bytes rather than tokens.
2. **That did not produce uniform cost savings.** Paired list-price input-cost deltas (arm B against arm A, same family, known costs) range from −15.9% to +93.6%, with the true-Fable Haiku family at +49.3%. The Luna true-Fable cost comparison is inconclusive because all four of its episodes have no whole-run cost.
3. **Artifact pass is not semantic completion.** 24 of 32 formal and supplement model episodes produced a passing artifact. The eight failures are four Haiku lookups that added prose outside the required JSON, one Luna staged-list failure, and three Luna true-Fable budget failures. Several workflow records are incomplete (see [Semantic evidence](#semantic-evidence)). Two repeats per cell cannot establish a ≤2 percentage-point non-inferiority bound.
4. **Budget deviation.** The aggregate output-token cap (500,000, measured as the runner's `usage.output_tokens`, which includes thinking) was exceeded by at least 8,416 tokens. The overshoot happened in the final Claude retry episode, which started under the cap. See [Budgets, timing and cost](#budgets-timing-and-cost).
5. **Recommendation.** Stop model spending for this pilot. Keep #290 open. Resolve the focused correctness, documentation and telemetry issues listed below before any formal expansion to at least five paired repeats per family.

## Scope and provenance

- **Source revision:** `ac519fa204ec90feb5067bc2525381b8820d045e`. Protocol registered 2026-10-14 before model calls.
- **Arms:** A = same canonical router and documents, plus an experiment-only eager document-read timing instruction. B = experiment text requesting active-step disclosure. Neither arm is an unmodified natural-policy control. Eager compliance remains unverified.
- **Models:** `gpt-6-luna` (Codex CLI 0.162.1, effort high) and `claude-haiku-5-5` (Claude CLI 2.1.299, effort high). Subscription authentication; no API keys were created or read.
- **Host integration:** the normal native UserPromptSubmit hook invoked the unchanged canonical router. Codex used explicit native hooks with its documented automation trust option; Claude used project-scoped settings. This is not full-plugin parity.
- **Public selection:** taken from `0b221bf` on `origin/fix/290-minimal-fable-workflow`, not `main`. Fixtures are pinned public tasks used through adapters:
  - QuixBugs `find_in_sorted` at `4257f44`, seven pinned upstream JSON cases through Python assertions.
  - Aider Polyglot `simple-linked-list` at `7e0611e`, 23 assertions through an explicit matcher adapter.
  - This is not an official leaderboard score. TerminalBench was not run.
- **Workloads and timeouts:** `profile-lookup` (synthetic Harness contract probe, 180 s); `quixbugs-find-in-sorted` (repair, 300 s); `polyglot-simple-linked-list-staged` (three ordered dependent stages, 600 s).
- **Fable supplement:** the same linked-list prompt prefixed with `Use Fable staged execution.`, which the tier router maps to `tier3/fable-staged`. It deliberately requests the topology this issue must preserve; it is not a neutral whole-Harness benchmark.
- **Order deviation:** repeat 1 runs AB and repeat 2 BA within each model/workload block. The preregistration also said “alternating model blocks”, but `run.py` groups models within workloads. That planned alternation was not implemented. The immutable protocol is preserved; provider cache residency was uncontrolled.
- **Environment:** macOS 26.6.2 arm64; agent Node v24.14.1 observed; inspection shell Node v25.9.0 ([preflight/environment.json](preflight/environment.json)).

## Episode accounting

40 attempts were retained. None were removed.

| Set | Episodes | Outcome |
|---|---:|---|
| Initial formal (protocol) | 24 | 3 workloads × 2 arms × 2 repeats × 2 models |
| True-Fable supplement, Luna | 4 | Ran. 1 artifact pass; 3 agent-budget failures (600 s cap) |
| True-Fable supplement, Haiku (original) | 4 | Pre-model startup failures: `hook-settings.json` missing. Infrastructure, outside the behavioral denominator |
| True-Fable supplement, Haiku (symmetric retry) | 4 | Ran after the fixture prerequisite fix (#314). 4 artifact passes |
| Preflight | 4 | Two probe sets, one per model each. The initial Haiku probe hit the 3-turn smoke cap, a preflight configuration failure. Retained, not formal |

Total: 32 formal model episodes + 4 preflight + 4 pre-model infrastructure launches = 40.

## Results

The following tables are regenerated by `python3 benchmarks/issue290-pilot/replay.py`; `--check` verifies the committed ledger, groups, pair records and these exact table bytes. They replace the original whole-shell-output reference counts.

<!-- BEGIN REPLAY TABLES -->
<!-- Generated by replay.py; parent-stream content attribution only. -->
| Family | Model | Pass / quality n | Excluded attempts |
|---|---|---:|---:|
| True Fable | claude | 4/4 | 4 |
| True Fable | codex | 1/4 | 0 |
| polyglot-simple-linked-list-staged | claude | 4/4 | 0 |
| polyglot-simple-linked-list-staged | codex | 3/4 | 0 |
| profile-lookup | claude | 0/4 | 0 |
| profile-lookup | codex | 4/4 | 0 |
| quixbugs-find-in-sorted | claude | 4/4 | 0 |
| quixbugs-find-in-sorted | codex | 4/4 | 0 |

### Attributable reference bytes (lower bound)

| Family | Model | Included / candidate pairs | A | B | Delta |
|---|---|---:|---:|---:|---:|
| True Fable | claude | 2/2 | 28933 | 30824 | +6.5% |
| True Fable | codex | 2/2 | 52706 | 18190 | -65.5% |
| polyglot-simple-linked-list-staged | claude | 2/2 | 8315 | 6130 | -26.3% |
| polyglot-simple-linked-list-staged | codex | 2/2 | 44046 | 6132 | -86.1% |
| profile-lookup | claude | 2/2 | 37914 | 7142 | -81.2% |
| profile-lookup | codex | 2/2 | 37914 | 7142 | -81.2% |
| quixbugs-find-in-sorted | claude | 2/2 | 30156 | 6247 | -79.3% |
| quixbugs-find-in-sorted | codex | 2/2 | 30156 | 7731 | -74.4% |

### List-price input cost (frozen telemetry)

| Family | Model | Included / candidate pairs | A | B | Delta |
|---|---|---:|---:|---:|---:|
| True Fable | claude | 2/2 | 0.042330 | 0.063211 | +49.3% |
| True Fable | codex | 0/2 | unknown | unknown | unknown |
| polyglot-simple-linked-list-staged | claude | 2/2 | 0.022892 | 0.034584 | +51.1% |
| polyglot-simple-linked-list-staged | codex | 2/2 | 0.031545 | 0.031368 | -0.6% |
| profile-lookup | claude | 2/2 | 0.009629 | 0.008103 | -15.9% |
| profile-lookup | codex | 2/2 | 0.003494 | 0.004594 | +31.5% |
| quixbugs-find-in-sorted | claude | 2/2 | 0.016405 | 0.021596 | +31.6% |
| quixbugs-find-in-sorted | codex | 2/2 | 0.013630 | 0.026382 | +93.6% |
<!-- END REPLAY TABLES -->

Quality excludes the four pre-model startup failures and preflight. Genuine agent budget failures remain failures. Each numeric metric has its own included/excluded count in [group-summary.json](evidence/group-summary.json); missing whole-run costs remain `null`. Pair deltas use only pairs with both measurements, and an all-unknown cost cell remains unknown.

**Reference metric boundary:** declared-bundle filesystem-access candidates, total shell-output bytes, content-attributed reference bytes, and uncertain/mixed bytes are separate fields. Full-file matches and distinctive contiguous partial lines count toward a conservative lower bound; short fragments, transformed output (`cat doc | wc -l`), numbered/modified text, undeclared files and unobserved child reads do not become claimed content bytes. Unknown transformations are not assigned zero physical activity.

**A's prior zero-read anomaly:** Haiku initial staged-list A2 now has 3,065 attributable bytes, from a compound TDD/verification read missed by the old whole-command veto. This resolves that zero as a counter defect. It still does not prove that A read every requested Fable reference. Some prior B>A results change after removing non-reference/mixed bytes; true-Fable Haiku remains B>A. The lookup −81.16% remains only a descriptive observation under the unverified intervention.

## Semantic evidence

- **Artifacts are not semantic completion.** Passing an artifact check does not show that required workflow steps ran.
- **Claude true-Fable stage records remained `planned`** in both B episodes and are absent in the A episodes, even though all four artifacts passed.
- **Luna true-Fable step records stayed `pending`** in all four episodes, while the stage records show `pass` in those episodes (one `fail` in B1).
- **Required-binding counts are not unresolved-binding counts.** The analyzer's `required_bindings_unresolved` field counts every binding record whose status is not `loaded`, including per-step `pending` placeholders. It is retained in the ledger but not used as a headline.
- **TDD invocation (#318 and identity correction, 2026-10-31).** `tdd_quality_gate_name_matched_invocation` explicitly means a conservative name/path-matched invocation, not established repository identity or a successful verdict. Only supported relative gate paths and npm gate names count; unrelated `quality-gate.js` basenames, npm `--prefix`/workspace relocations (including options after the script name), quotes, comments, help and dry-run forms do not. No archived command changes its already-corrected Boolean value: all 40 are false. The old `tdd_quality_gate_executed` name survives only in immutable historical archive snapshots.
- **Child dispatch and accounting (Luna true Fable).** All four Luna true-Fable parent transcripts contain `spawn_agent` dispatch records, but the CLI stream does not expose worker usage or model IDs. The whole cost is therefore unknown for all four, and parent-only cost is retained separately (#315). Claude worker logs were normalized, and the child model and effort were verified as `haiku-5-5` / `high`.

## Budgets, timing and cost

### Wall time

- 5,260.8 s summed parent wall time across the 32 formal and supplement model episodes. Child waits are included; parallel durations are not added. This is under the 7,200 s aggregate budget.
- Excluded: four pre-model launches (4.1 s) and preflight (72.3 s).

### Output tokens (deviation)

- The runner enforces `aggregate_output_token_cap` (500,000) against `usage.output_tokens`, which includes thinking. The checks run before each episode starts ([run.py:252](run.py), [fable-supplement.py:51](fable-supplement.py)).
- The 32 model episodes sum to **at least 508,416** under that metric: final usage aggregates where present, plus 109,190 partial request sums for the three interrupted Luna true-Fable episodes. The total is a lower bound because unobserved worker output is excluded.
- The final Claude retry episode (`claude polyglot-simple-linked-list-staged`, arm A, repeat 2) started at a cumulative 485,478 and ended at 508,416, exceeding the cap by at least 8,416 (1.7%). The pre-start check admitted it, so the overshoot was not blocked. The protocol says no higher limit was authorized. Report this as a deviation.
- The protocol's per-episode cap of 80,000 output tokens was not exceeded. The largest observed episode total was 48,588, a partial count in an interrupted episode.
- The protocol text does not use the word "visible". Under a visible-only reading (subtracting thinking tokens where exposed), the total is about 165,000, well under the cap. That is not the metric the runner enforced, and it is not used to claim compliance.
- No further model calls were made after this point.

### Cost

- **Known token-only subtotal:** 0.50788911 USD across the 28 completed, priced formal and supplement episodes (input-only component 0.32976261 USD).
- **Unknown:** the whole cost of the four Luna true-Fable episodes. The worker usage that would be needed is not exposed in the parent CLI stream.
- **Preflight:** excluded from formal cost comparisons; the interrupted smoke episode has no asserted whole-run cost.
- **Basis:** historical price assumptions, not subscription billing or verified current prices. [pricing-assumptions.json](pricing-assumptions.json) freezes the original constants. The original report named the following provider URLs, but no immutable provider-page capture was retained; the Haiku `multiplier=5` is an unverified original-analyzer assumption:
  - Luna: input 0.10, cache read 0.01, cache write 0.125, output 0.50 USD per 1M tokens; higher request-tier modifiers above 272k input tokens ([source](https://developers.openai.com/api/docs/models/gpt-6-luna)).
  - Haiku 5.5: input 0.10, output 0.50, cache write 5 min 0.125, cache write 1 h 0.20, cache read 0.01 USD per 1M tokens; higher request-tier modifiers above 100k input tokens ([source](https://platform.claude.com/docs/en/about-claude/pricing)).
- **Excluded from the estimate:** Codex hosted tool fees, setup, research and orchestrator expense, and unobserved child usage. Native aggregate output includes thinking tokens, which are not double-counted.

## Exclusions and amendments

All amendments were registered before the affected model calls:

- [preflight/amendment.md](preflight/amendment.md): corrected the preflight smoke cap to the formal 35-turn cap after the initial Haiku probe; froze the fixture adaptations; defined the lookup rubric (six exact fields and JSON-only output after the hidden turn label).
- [preflight/fable-amendment.md](preflight/fable-amendment.md): added the genuine Fable supplement and the linked-worktree isolation it requires; shared the original budgets.
- [preflight/fable-infrastructure-amendment.md](preflight/fable-infrastructure-amendment.md): recorded the four Claude startup failures as infrastructure; added the fixture prerequisite check and fail-fast on absent router attribution; registered one symmetric retry for the two Claude pairs.

Exclusion rules:

- Four Claude true-Fable startups failed before model execution (`Settings file not found: .../hook-settings.json`). They are retained, classified as infrastructure, and kept outside the behavioral denominator (#314).
- The initial Haiku preflight probe is retained as a preflight configuration failure and is not a formal observation.
- The three Luna true-Fable budget failures are counted as failures. They were not excluded and no outcome-selected rerun was made.
- No Luna outcome was rerun.

## Known limitations

- Two repeats per model/workload/arm, one public task per family. This is not the issue's ≥5 paired repeats.
- Quality is not shown to be non-inferior. Artifact pass is not semantic completion.
- Cache residency was uncontrolled. Order effects are present (AB then BA). Some repo gates ran concurrently with early repair trials, so latency is descriptive and confounded.
- Costs reproduce historical assumptions, including an unverified Haiku large-context multiplier. Four Luna true-Fable whole costs are unknown. Private-host attribution cannot be independently re-fetched by replay; retained sanitized telemetry is explicitly frozen input.
- Host integration is an explicit project/CLI adapter, not full-plugin parity. Global scope, npm-package installation, and other host versions are not covered.
- Content attribution is a parent-stream lower bound. Native/numbered partial reads, unknown transformations and short coincidental matches stay uncertain. No new model run or efficacy claim follows from the corrected counters.

## Issues

| Issue | Title (short) | Relation to this PR |
|---|---|---|
| [#290](https://github.com/dyphn1/Harness-everything/issues/290) | Validate demand-driven reference loading | Parent. Refs only; stays open |
| [#308](https://github.com/dyphn1/Harness-everything/issues/308) | Haiku profile lookup adds prose despite JSON-only request | Refs |
| [#309](https://github.com/dyphn1/Harness-everything/issues/309) | `fast-uri` dev dependency advisories | Refs. No dependency change; audit baseline recorded |
| [#310](https://github.com/dyphn1/Harness-everything/issues/310) | `workflow-disposition --help` exits 2 | Refs |
| [#311](https://github.com/dyphn1/Harness-everything/issues/311) | Loaded TDD steps skip the required quality report | Refs |
| [#312](https://github.com/dyphn1/Harness-everything/issues/312) | Staged linked-list repair invents a head-contract conflict | Refs. Actual nested `Element` bug, no source conflict |
| [#313](https://github.com/dyphn1/Harness-everything/issues/313) | Scalar controller output crashes the pilot analyzer | Fixes in this PR (regression test) |
| [#314](https://github.com/dyphn1/Harness-everything/issues/314) | Linked Fable fixture omits Claude hook settings | Fixes in this PR (fixture regression test, prerequisite checks, fail-fast) |
| [#315](https://github.com/dyphn1/Harness-everything/issues/315) | Codex private-rollout dispatch and usage accounting gap | Refs |
| [#316](https://github.com/dyphn1/Harness-everything/issues/316) | Blocked Fable recovery reminder vs plan rejection | Refs |
| [#317](https://github.com/dyphn1/Harness-everything/issues/317) | Legacy contract path in `execution-phases.md:32` vs `CONTRACT-FORMAT.md:66` | Refs |
| [#318](https://github.com/dyphn1/Harness-everything/issues/318) | TDD quality-gate flag matches `tdd:quality` text in binding evidence | Corrected in this PR; invocation scope documented |

## Reproducibility and evidence

- **Code and inputs (committed):** [run.py](run.py), [fable-supplement.py](fable-supplement.py), [analyze.py](analyze.py), [export.py](export.py), [grader.cjs](grader.cjs), [host-hook.cjs](host-hook.cjs), [protocol.json](protocol.json), [sources.json](sources.json), [preflight/](preflight/), [fixtures/](fixtures/).
- **Raw evidence (local, not committed):** `/tmp/issue290-formal-20261014`, `/tmp/issue290-fable-20261014`, `/tmp/issue290-fable-claude-retry-20261014`, `/tmp/issue290-host-preflight-20261014`, `/tmp/issue290-host-preflight2-20261014`, and the analyzer output `/tmp/issue290-final-audit`. Raw files include local paths and reasoning-bearing transcripts.
- **Sanitized archive:** [evidence.tar.gz](evidence.tar.gz), 1,824,930 bytes, SHA-256 `93bcb349c6ebbdcd3673641f3dc23148e73e87a0ec975d31bf31d2731d828723`. It was rebuilt from the committed [export.py](export.py). It holds 621 exported files plus `inventory.json`. [evidence/archive.json](evidence/archive.json) records the archive hash and count.
- **Inventory:** [evidence/inventory.json](evidence/inventory.json) lists the raw and exported SHA-256 for every exported file. Replay verifies all 621 exported hashes against committed inventory entries. The original author-side verification also recorded raw-file hash comparisons; the private raw files are not available for independent verification from this checkout.
- **Current derived evidence:** [ledger](evidence/ledger.json) (40 rows), [group summary](evidence/group-summary.json) (22 groups), [pairs](evidence/replay/pairs.json), [generated tables](evidence/replay/tables.md), and [provenance](evidence/replay/provenance.json). The archive retains the historical audits unchanged.
- **Sanitization:** removes home, source-checkout and temporary paths; the host name (read at runtime); the local username; email addresses; and thinking and signature fields. The committed verification logs and `preflight/graders.json` were passed through the same sanitizer. Token counts and hashes are retained. The export and final scan reject configured provider-token, assigned-secret, authorization-header and private-key shapes, including nested JSON/log strings. Synthetic positive/negative tests exercise these classes; no finite pattern scanner proves absence of every possible secret. Public metadata remains: the `author:` field in skill frontmatter and the public GitHub owner name in documentation. One truncated shell path fragment (`/Users/d`) remains; it contains no identifying information.
- **Independent references:**
  - Polyglot: the original report recorded an independently authored reference in a private preflight temp directory; that private source is not a replay input. Its SHA-256 is `65c1189d1bf4a6956e0ba917fe0005b09dffea895329fbdf89dfaad54f8350eb`. The original local re-grade recorded 23/23, and the frozen skeleton (SHA-256 `f305a2ba…`, [preflight/frozen-files.json](preflight/frozen-files.json)) passed 0/23. Both `graders.json` entries name the same temp path, so the record does not show the hash directly; this hash is recorded here.
  - QuixBugs: the upstream reference (SHA-256 `cce13769543e2972d66ea61c9d1f1751836c719abf336be8f50f2702d19477ea`) is recorded in [preflight/graders.json](preflight/graders.json).
- **Historical helper tests:** original report: `analyze.test.py` 4/4, `fixture.test.py` 1/1, `hook.test.cjs` PASS. The #318 correction extends the analyzer suite to 7 tests, including recomputation of the TDD flag from all 40 archived transcripts. `py_compile` and `node --check` pass. See [verification/verification-report.md](verification/verification-report.md) for the original run.

## Offline correction and acceptance (2026-10-31)

Run from the repository root, without provider CLIs or host session directories:

```bash
python3 benchmarks/issue290-pilot/check.py
# Deliberately refresh derived expected values after reviewing an analyzer change:
python3 benchmarks/issue290-pilot/replay.py
```

The `pilot-offline-evidence` CI job runs Python helper tests, Node hook/grader regressions, syntax checks, deterministic replay and the final export/archive credential scan. Replay verifies all 621 exported file hashes and frozen reference contents against episode manifests, reruns available artifact checks, recomputes content attribution and gate-name signals, and rebuilds per-metric groups and descriptive pairs. It compares derived JSON and README tables against committed expected values.

Frozen inputs are the sanitized archive's request-usage records, aggregate usage, effort and child-dispatch metadata. These are historical observations, not independent recovery of private host sessions. Missing worker identities/usage and interrupted final aggregates remain unknown; whole costs depending on them remain `null`. Replay cannot prove the host actually billed these amounts or revalidate unretained provider prices. Raw hashes are historical metadata: only exported hashes are verifiable from this checkout.

The original `evidence.tar.gz`, inventory, transcripts, protocol, budgets and model outcomes are unchanged. The new classifier is shared by `run.py` and `analyze.py`; grader equality no longer loses undefined/NaN/infinite values through JSON conversion, both independent graders retain timeouts, and both live runners stop before another trial if canonical router attribution is absent. This correction supplies deterministic tooling evidence, not a new behavioral study. Independent review and final-head CI remain required before merge.

Cross-host replay initially exposed filesystem-dependent stage-binding order. State traversal now sorts every matched path, with a negative control that reverses filesystem enumeration. The 26 Python tests, Node regressions and local offline gate pass; [verification/offline-correction.json](verification/offline-correction.json) records tested implementation hashes and the earlier CI failures. Governance remains an external review disposition.
