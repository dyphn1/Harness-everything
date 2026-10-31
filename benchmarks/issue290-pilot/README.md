# Issue #290 pilot report: active-step reference disclosure

**Status:** pilot only. Issue #290 stays open. This report makes no benefit claim, no quality non-inferiority claim, and no formal efficacy claim.

Question (from [protocol.json](protocol.json)): does active-step reference disclosure reduce observed reference reads and execution overhead without losing required workflow behavior?

## Conclusion

1. **Reference-read bytes fell for the lookup family.** Exact returned reference bytes were 37,914 under arm A and 7,142 under arm B across two paired episodes per model: an 81.16% reduction for both models. These are bytes, not tokenizer tokens.
2. **That did not produce uniform cost savings.** Paired list-price input-cost deltas (arm B against arm A, same family, known costs) range from −15.9% to +93.6%, with the true-Fable Haiku family at +49.3%. The Luna true-Fable cost comparison is inconclusive because all four of its episodes have no whole-run cost.
3. **Artifact pass is not semantic completion.** 24 of 32 formal and supplement model episodes produced a passing artifact. The eight failures are four Haiku lookups that added prose outside the required JSON, one Luna staged-list failure, and three Luna true-Fable budget failures. Several workflow records are incomplete (see [Semantic evidence](#semantic-evidence)). Two repeats per cell cannot establish a ≤2 percentage-point non-inferiority bound.
4. **Budget deviation.** The aggregate output-token cap (500,000, measured as the runner's `usage.output_tokens`, which includes thinking) was exceeded by at least 8,416 tokens. The overshoot happened in the final Claude retry episode, which started under the cap. See [Budgets, timing and cost](#budgets-timing-and-cost).
5. **Recommendation.** Stop model spending for this pilot. Keep #290 open. Resolve the focused correctness, documentation and telemetry issues listed below before any formal expansion to at least five paired repeats per family.

## Scope and provenance

- **Source revision:** `ac519fa204ec90feb5067bc2525381b8820d045e`. Protocol registered 2026-10-14 before model calls.
- **Arms:** A = same canonical router and documents, plus an experiment-only eager document-read timing instruction. B = current active-step-only disclosure. The eager arm A may not reproduce organic release behavior.
- **Models:** `gpt-6-luna` (Codex CLI 0.162.1, effort high) and `claude-haiku-5-5` (Claude CLI 2.1.299, effort high). Subscription authentication; no API keys were created or read.
- **Host integration:** the normal native UserPromptSubmit hook invoked the unchanged canonical router. Codex used explicit native hooks with its documented automation trust option; Claude used project-scoped settings. This is not full-plugin parity.
- **Public selection:** taken from `0b221bf` on `origin/fix/290-minimal-fable-workflow`, not `main`. Fixtures are pinned public tasks used through adapters:
  - QuixBugs `find_in_sorted` at `4257f44`, seven pinned upstream JSON cases through Python assertions.
  - Aider Polyglot `simple-linked-list` at `7e0611e`, 23 assertions through an explicit matcher adapter.
  - This is not an official leaderboard score. TerminalBench was not run.
- **Workloads and timeouts:** `profile-lookup` (synthetic Harness contract probe, 180 s); `quixbugs-find-in-sorted` (repair, 300 s); `polyglot-simple-linked-list-staged` (three ordered dependent stages, 600 s).
- **Fable supplement:** the same linked-list prompt prefixed with `Use Fable staged execution.`, which the tier router maps to `tier3/fable-staged`. It deliberately requests the topology this issue must preserve; it is not a neutral whole-Harness benchmark.
- **Order:** repeat 1 runs AB and repeat 2 runs BA within each model/workload block. Provider cache residency was not controlled.
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

### Artifact outcomes (passes per 2 episodes)

| Family | Haiku A | Haiku B | Luna A | Luna B |
|---|:-:|:-:|:-:|:-:|
| Lookup (synthetic contract probe) | 0/2 | 0/2 | 2/2 | 2/2 |
| QuixBugs repair (7 pinned cases) | 2/2 | 2/2 | 2/2 | 2/2 |
| Staged linked list (initial) | 2/2 | 2/2 | 2/2 | 1/2 |
| Staged linked list, true Fable | 2/2 | 2/2 | 1/2 | 0/2 |

- **Lookup:** all four Haiku episodes selected the correct six fields but added prose outside the required JSON, so the strict JSON-only rubric failed them (#308). All four Luna episodes passed.
- **Repair:** all eight episodes passed the seven pinned cases.
- **Staged list, Luna B1:** the single initial-series failure.
- **True Fable, Luna:** A1 and B1, B2 hit the 600 s cap and count as agent-budget failures. A2 passed.

### Reference reads (returned bytes, summed over the cell)

| Family | Haiku A | Haiku B | Luna A | Luna B |
|---|---:|---:|---:|---:|
| Lookup | 37,914 | 7,142 (−81.2%) | 37,914 | 7,142 (−81.2%) |
| QuixBugs repair | 36,190 | 7,272 (−79.9%) | 32,169 | 62,445 (+94.1%) |
| Staged list (initial) | 9,016 | 23,099 (+156.2%) | 76,674 | 54,564 (−28.8%) |
| Staged list, true Fable | 27,713 | 24,878 (−10.2%) | 144,079 (includes interrupted runs) | 102,509 (includes interrupted runs) |

Reference reads did not fall uniformly. Lookup shows the clearest reduction, and repair and initial staged rows show increases in arm B for at least one model.

### Paired cost deltas (list-price input cost, arm B against arm A)

| Family | Model | A (USD) | B (USD) | Delta |
|---|---|---:|---:|---:|
| Lookup | Haiku | 0.009629 | 0.008103 | −15.9% |
| Lookup | Luna | 0.003494 | 0.004594 | +31.5% |
| Repair | Haiku | 0.016405 | 0.021596 | +31.6% |
| Repair | Luna | 0.013630 | 0.026382 | +93.6% |
| Staged list (initial) | Haiku | 0.022892 | 0.034584 | +51.1% |
| Staged list (initial) | Luna | 0.031545 | 0.031368 | −0.6% |
| Staged list, true Fable | Haiku | 0.042330 | 0.063211 | +49.3% |
| Staged list, true Fable | Luna | unknown | unknown | inconclusive |

Each cell has two episodes, so these deltas are descriptive. There is no universal savings result.

## Semantic evidence

- **Artifacts are not semantic completion.** Passing an artifact check does not show that required workflow steps ran.
- **Claude true-Fable stage records remained `planned`** in both B episodes and are absent in the A episodes, even though all four artifacts passed.
- **Luna true-Fable step records stayed `pending`** in all four episodes, while the stage records show `pass` in those episodes (one `fail` in B1).
- **Required-binding counts are not unresolved-binding counts.** The analyzer's `required_bindings_unresolved` field counts every binding record whose status is not `loaded`, including per-step `pending` placeholders. It is retained in the ledger but not used as a headline.
- **TDD gate (#318 correction, 2026-10-31).** The original substring detector falsely flagged `claude-quixbugs-find-in-sorted-r2-B` because binding evidence mentioned `npm tdd:quality gate N/A`. The detector now recognizes explicit `npm run tdd:quality` or `node …/quality-gate.js` invocations, including supported transparent wrappers, and rejects quoted prose, comments and unrelated command arguments. Recomputing this flag from all 40 archived transcripts changes exactly that row from `true` to `false`; none of the eight repairs has a detected invocation. This conservative detector does not prove successful gate completion or infer execution inside compound/dynamic shell programs. The original archive and transcripts are unchanged; the current ledger carries this flag-only correction, while archived historical audits retain their original value. Group summaries, model results and cost conclusions are unchanged.
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
- **Preflight (not in the subtotal):** 0.01348616 USD across four episodes.
- **Basis:** list-price estimate, not subscription billing. Prices were fetched 2026-10-14:
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
- Costs are list-price estimates. Four Luna true-Fable whole costs are unknown.
- Host integration is an explicit project/CLI adapter, not full-plugin parity. Global scope, npm-package installation, and other host versions are not covered.
- Analyzer defects affect some fields (see [Semantic evidence](#semantic-evidence) and #318).

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
| [#318](https://github.com/dyphn1/Harness-everything/issues/318) | TDD quality-gate flag matches `tdd:quality` text in binding evidence | Refs. Filed during this report |

## Reproducibility and evidence

- **Code and inputs (committed):** [run.py](run.py), [fable-supplement.py](fable-supplement.py), [analyze.py](analyze.py), [export.py](export.py), [grader.cjs](grader.cjs), [host-hook.cjs](host-hook.cjs), [protocol.json](protocol.json), [sources.json](sources.json), [preflight/](preflight/), [fixtures/](fixtures/).
- **Raw evidence (local, not committed):** `/tmp/issue290-formal-20261014`, `/tmp/issue290-fable-20261014`, `/tmp/issue290-fable-claude-retry-20261014`, `/tmp/issue290-host-preflight-20261014`, `/tmp/issue290-host-preflight2-20261014`, and the analyzer output `/tmp/issue290-final-audit`. Raw files include local paths and reasoning-bearing transcripts.
- **Sanitized archive:** [evidence.tar.gz](evidence.tar.gz), 1,824,930 bytes, SHA-256 `93bcb349c6ebbdcd3673641f3dc23148e73e87a0ec975d31bf31d2731d828723`. It was rebuilt from the committed [export.py](export.py). It holds 621 exported files plus `inventory.json`. [evidence/archive.json](evidence/archive.json) records the archive hash and count.
- **Inventory:** [evidence/inventory.json](evidence/inventory.json) lists the raw and exported SHA-256 for every exported file. All 621 exported hashes and all 621 raw hashes were verified after extraction into a fresh directory.
- **Ledger and summary:** [evidence/ledger.json](evidence/ledger.json) (40 rows) and [evidence/group-summary.json](evidence/group-summary.json) (22 groups).
- **Sanitization:** removes home, source-checkout and temporary paths; the host name (read at runtime); the local username; email addresses; and thinking and signature fields. The committed verification logs and `preflight/graders.json` were passed through the same sanitizer. Token counts and hashes are retained. The export fails closed on credential-shaped strings. Public metadata remains: the `author:` field in skill frontmatter and the public GitHub owner name in documentation. One truncated shell path fragment (`/Users/d`) remains; it contains no identifying information.
- **Independent references:**
  - Polyglot: the independently authored reference is still present in its preflight temp directory. Its SHA-256 is `65c1189d1bf4a6956e0ba917fe0005b09dffea895329fbdf89dfaad54f8350eb`. Re-graded locally without model calls, it passed 23/23, and the frozen skeleton (SHA-256 `f305a2ba…`, [preflight/frozen-files.json](preflight/frozen-files.json)) passed 0/23. Both `graders.json` entries name the same temp path, so the record does not show the hash directly; this hash is recorded here.
  - QuixBugs: the upstream reference (SHA-256 `cce13769543e2972d66ea61c9d1f1751836c719abf336be8f50f2702d19477ea`) is recorded in [preflight/graders.json](preflight/graders.json).
- **Helper tests:** original report: `analyze.test.py` 4/4, `fixture.test.py` 1/1, `hook.test.cjs` PASS. The #318 correction extends the analyzer suite to 7 tests, including recomputation of the TDD flag from all 40 archived transcripts. `py_compile` and `node --check` pass. See [verification/verification-report.md](verification/verification-report.md) for the original run.
