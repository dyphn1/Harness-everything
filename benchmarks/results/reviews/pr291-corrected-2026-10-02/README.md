# PR #291 corrected follow-up: Luna three-size A/B

Date: 2026-10-02, Asia/Taipei. Product snapshot: `7a0f72e584ee16396d98b5322bc25feef2b4644c`. Fresh control A = PR base `2716be9feb3e6b986c0f5da884ed4a686b95791b`; treatment B = corrected snapshot. Both are linked Git worktrees; the main worktree was untouched. The publication commit contains only evidence and does not change the tested product files.

## Fix and evidence

Two reported P2 gaps are fixed: validate entire lookup/output/negative clauses, so same-clause actions retain execution routing; recognize comma/and-separated canonical JSON output fields so a pure lookup selects direct-single. Unknown prose conservatively stays on execution routing. Straight-quoted run/use invocation explanations remain data. Common polite Chinese lookup phrasing also has a regression. Canonical and packaged routers were synchronized without version bumps. Pending changelog and the capability paragraph were updated.

TDD: the first added regression set failed with 52 assertions before the fix and passed with zero afterward. Independent Luna review found a further polite-Chinese false negative; its regression failed with 5 assertions before that follow-up and passed afterward. Final independent Unicode-valid boundary probes: **14/14**. The corrupted initial PowerShell encoding probe is preserved separately and excluded from product mismatch counts. TDD quality gate: **PASS, 100%**, with documented N/A classes and two equivalent clean subprocess observations; this score covers the bounded lookup requirement, not the whole repository. All **14 required repository gates passed**; the final Chinese change received repeated `test`, `test:mutations` and `test:mechanism` gates in addition to the passing targeted routing/quality checks. Waza was unavailable on this host.

## Frozen behavioral protocol

Six fresh `gpt-6-luna / xhigh` native collaboration agents; one sample per arm and case. Small = six-field profile JSON; medium = profile explanation before an isolated README correction; large = six-module/fourteen-file DI migration **planning**. Exact task and initial-fixture hashes match the previous round and each fresh pair. The same bounded wrapper was intended for all six trials, with trial IDs substituted and the artifact root changed from the previous round. Native task-message payloads are encrypted and SQLite first_user_message is empty, so wrapper equality cannot be independently verified from retained telemetry; agent-prompt.txt explicitly records this gap rather than an empty prompt hash. Agents were prohibited from full stage execution/delegation in both arms. This is a bounded instruction-surface probe, not an end-to-end migration or live-host hook test. Read attempts are retained in ledgers; a logged path can be a failed snapshot read. Caching and scheduling were observed, not controlled.

## Complete trial counters

| Trial | Input incl. cache | Uncached input | Cached input | Cache writes | Output (reasoning subset) | Total | Standard USD-equivalent | Elapsed seconds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| small-A | 181,141 | 18,837 | 162,304 | 0 | 6,714 (5,136) | 187,855 | 0.00686374 | 139.198 |
| small-B | 208,613 | 9,957 | 198,656 | 0 | 2,951 (1,685) | 211,564 | 0.00445776 | 73.606 |
| medium-A | 355,282 | 40,658 | 314,624 | 0 | 8,895 (6,161) | 364,177 | 0.01165954 | 192.723 |
| medium-B | 258,701 | 23,181 | 235,520 | 0 | 12,098 (9,583) | 270,799 | 0.0107223 | 240.818 |
| large-A | 492,370 | 46,930 | 445,440 | 0 | 27,517 (14,672) | 519,887 | 0.0229059 | 529.371 |
| large-B | 352,795 | 36,891 | 315,904 | 0 | 19,159 (13,833) | 371,954 | 0.01642764 | 389.914 |

A aggregate input **1,028,793**, cached **922,368**, output **43,126**, total **1,071,919**, equivalent **US$0.04142918**. B aggregate input **820,109**, cached **750,080**, output **34,208**, total **854,317**, equivalent **US$0.03160770**. Combined six-trial equivalent **US$0.07303688**. Shared parent fix/setup/verification/reporting and the independent boundary-review thread are excluded from both A/B arms.

Elapsed seconds are native rollout `task_started` to `task_complete`, excluding launch/startup overhead; exact timestamps are in `timing.json`. Concurrent trial durations must not be summed as experiment wall time.

Every per-request token record is summed once and reconciled to the completed thread's cumulative counter. Source model/effort, unique response IDs, rollout SHA-256 and sanitized counters are in `usage.json`; raw reasoning text is not exported. Input includes cached input; reasoning is included in output. All cache writes are zero, and no individual request exceeds 272K input. Official [Luna Standard rates](https://developers.openai.com/api/docs/models/gpt-6-luna), USD per million: uncached input 0.10, cached input 0.01, writes 0.125, output 0.50. Formula: `(uncached*.10 + cached*.01 + writes*.125 + output*.50)/1e6`. These are **Standard API-equivalent estimates**, not a subscription invoice or attributable quota percentage; actual settled charges are unavailable.

## Task and topology outcomes

| Trial | Router topology | Canonical profile | Fixture behavior check |
|---|---|---|---|
| small-A | tier3 / fable-staged | True | True |
| small-B | tier1 / direct-single | True | True |
| medium-A | tier3 / fable-staged | True | True |
| medium-B | tier3 / fable-staged | True | True |
| large-A | tier3 / fable-staged | True | True |
| large-B | tier3 / fable-staged | True | True |

Corrected small B routes tier1/direct-single and returns the canonical profile. Medium B keeps staged obligations and performs the requested isolated README change. Large B keeps staged routing and produces a scoped dependency plan with failable checks, an isolation/degraded disposition and final independent verifier. Large output structural checks compare dependency ordering and authorized write scopes against the frozen fourteen-file input; they do not prove that future implementation or verification succeeds. The control small lookup still routes staged, as expected for the unfixed PR base; semantic answers are scored separately from routing contracts.

## Descriptive comparison with the earlier PR head

| Case | Previous head topology | Corrected topology | Previous head total tokens / USD-equivalent | Corrected total tokens / USD-equivalent |
|---|---|---|---:|---:|
| small | fable-staged | direct-single | 200,962 / 0.00588388 | 211,564 / 0.00445776 |
| medium | direct-single | fable-staged | 291,368 / 0.0072856 | 270,799 / 0.0107223 |
| large | fable-staged | fable-staged | 317,028 / 0.01474304 | 371,954 / 0.01642764 |

These earlier-head vs corrected-head cells are separate sampling rounds, not concurrent paired controls. They demonstrate the corrected topology on unchanged prompts, but their token/cost changes cannot be assigned entirely to the fix. Fresh A/B counters above also include variable model choices, discretionary reads, warm caching and script corrections. One sample per cell cannot establish a general savings or behavior guarantee. The mixed-action fix may consume more tokens because it restores the requested execution obligations.

Control large A has three retained structural flags: read scopes contain prose summaries instead of explicit allowed paths; its fresh independent reviewer is called `fable-orchestrator` rather than the required `fable-verifier`; and top-level `mutationPerformed: true` contradicts its source-mutation-false planning statement. These are artifact/reporting limitations, not proof of actual source edits or a causal router regression. Corrected large B passes all of those checks. Control small A puts its canonical fields under `answer` and uses a string `profile`; the semantic field check accepts that location, while preserving the original output.

Artifact scoring accepts equivalent JSON key spellings (`isolation`/`isolationDisposition`, `write`/`writable`/`writeScope`, `read`/`readOnly`/`readScope`). Coverage means read/write scope covers the fourteen input files and no authorized path escapes that set; it does not require changing every file. In particular, corrected B preserves route handler signatures with a read-only `src/http/routes.js` scope. This corrects the older audit's overly strict write-every-file assumption without changing trial outputs or requests.

All sanitized inputs, answers, contracts, router outputs and read ledgers are retained. `audit.py` needs original private local rollouts; arithmetic can be recomputed on any host from exported `usage.json`. `prepare.py` reconstructs the initial fixtures but must not run over retained trial outputs. `previous-round-usage.json` retains the earlier round for transparent comparison. `scorecards.json`/`scorecards.md` retain the separate four-dimension agent artifact rubric. `sha256.json` seals delivered artifacts.
