# Public coding baseline for the next paired Luna study

Research date: 2026-10-02. **Design only; no new agent trials have run.**
Source paths and SHA-256 hashes are recorded in [selection.json](selection.json).
That manifest verifies source identity, not executability or grader correctness.
[protocol.json](protocol.json) records proposed settings and outstanding preflight.

The PR #291 pilot used Harness-specific requests and different hosts for the
no-Harness arm. Its completion and cost observations do not establish a causal
benefit on ordinary coding tasks. The next study uses neutral tasks requiring
working code, with external acceptance tests. It supplements the repository's
[paired evidence contract](../../behavioral-evals/PAIRED-BENCHMARK.md).

## Public sources and selected tasks

| Our stratum | Public source | Selected task IDs | Completion evidence |
|---|---|---|---|
| Small: local algorithm repair | [QuixBugs](https://github.com/jkoppel/QuixBugs) | `find_in_sorted`, `gcd`, `flatten` | All required, externally executed Python tests pass; preserve the function contract. |
| Medium: module implementation | [Aider Polyglot](https://github.com/Aider-AI/polyglot-benchmark), JavaScript | `simple-linked-list`, `react`, `rest-api` | All activated upstream Jest tests pass; preserve the specified API. |
| Large: existing system repair | [Terminal-Bench 4.0](https://www.tbench.ai/news/terminal-bench-4-0) | `payments-pipeline-fix`, `live-database-cutover`, `wal-recovery-ordering` | Independent verifier accepts the final artifacts, including the task's correctness and resource constraints. |

These strata are our classifications, not official difficulty labels. The three
sources exercise different languages and domains; compare paired variants within
each task and stratum. Do not interpret cross-stratum differences as a pure
effect of task size. Tasks were selected before new model outcomes for diversity
of contracts and an external grader, not sampled randomly from each full suite.

QuixBugs supplies small buggy programs and reference repairs. Treat this older
public corpus as a smoke test, with potential training contamination. Do not
expose its reference repairs or repository history to the agent. Aider's
[official leaderboard](https://aider.chat/docs/leaderboards/) uses its own editing
and retry setup; our Codex-based subset is an adapted study, not an official
Aider score. Terminal-Bench is also a selected coding/systems subset, not the
full leaderboard. A private, independently authored holdout is needed before
generalizing beyond these public tasks.

Terminal-Bench's pinned task configurations allow 28,800 seconds per agent and
declare separate verifiers. Preserve their resource limits and verifier timeouts.
Any shortened run is a separately named, capped adaptation. Never silently
substitute Terminal-Bench 2.0 or a moving latest dataset. Use the revisions in
`selection.json`; registry downloads must match the pinned task contents.

## Comparison and controls

The default question is the effect of **Harness skill instructions**, using two
arms: clean vanilla versus corrected PR #291 Harness skill text. Hooks are
disabled in both arms. Freeze both the host and Harness source commit before
execution. This does not measure lifecycle-hook enforcement or the full plugin.

To measure the incremental PR change, add a third arm containing PR-base Harness
skill text, on the same host. Predeclare two distinct contrasts: corrected versus
vanilla, and corrected versus PR base. A plugin-enforcement experiment needs its
own preflight and design; do not mix that intervention into the skill-text result.

- Use the same Luna model and reasoning setting, exact Codex CLI build, Linux
  container image, tools, permissions, network policy, CPU/RAM, and budgets in
  both arms for each task. Store the returned model identifier, not just an alias.
- Use byte-identical task prompts and fresh fixture snapshots. No Fable-specific
  wording, required stage names, worktree rituals, or planning-only deliverables.
  For QuixBugs, use one frozen neutral repair instruction plus the source contract;
  for the other sources, use the upstream instructions unchanged.
- Mount only task inputs and permitted development tests. Keep gold solutions,
  grader files, reward paths, and answer-search access outside the agent boundary.
  Inspect loaded instructions/tools to prove the vanilla arm did not inherit
  Harness AGENTS.md, skills, hooks, memories, or parent session context.
- Give both arms equal delegation capability. Every worker/reviewer uses the same
  Luna configuration; all child usage counts. Do not grant extra tools to Harness.
- Run three independent episodes per task per arm: 9 tasks × 3 repeats × 2 arms =
  **54 planned trials**; a third PR-base arm makes 81. Repeats start fresh and are
  not a best-of-three repair budget. Persist a randomized, blocked launch order
  with seed 20261002 before execution; avoid overlapping resource-heavy trials.
- Cache residency may be provider-controlled. Record its observed usage and
  launch order; do not claim an equal cold cache without evidence. If cache cannot
  be controlled, report uncached-equivalent cost separately from measured usage.

## Grader preflight and completion

Before paying for model trials, build the pinned fixtures, freeze dependencies
and image digests, inspect instruction/test alignment, and demonstrate a reference
solution passes while the untouched fixture fails. Record both logs. Fix grader
problems symmetrically and freeze the corrected adaptation before either arm runs.
If a task is infeasible, report it and replace it before outcomes are observed.

The inspected Polyglot fixtures contain `xtest` cases: activate **all** exercise
tests in a frozen grader copy, verify the expected test count, and forbid skips.
Running the default first test alone is not completion. The `promises` candidate
was excluded during source review because some named combinator tests do not
exercise that combinator and the stated built-in semantics need clarification.
QuixBugs fixtures also need their JSON data, loader and pytest configuration;
the source-selection manifest is not a complete runnable fixture inventory.

Follow Harbor's [verifier boundary](https://docs.harborframework.com/core-concepts/tasks/verifier):
grade final artifacts after the agent finishes, independently of agent-written
tests or self-reported success. Validate transfer paths and grader integrity.
Do not accept an agent-created reward file as evidence.

Primary outcome is binary complete/not complete: all required acceptance tests
and declared constraints pass with no grader tampering. A plan alone fails.
For diagnostics, preregister named requirement groups and report their pass/fail
status; raw test counts are not a percentage of product completion. No primary
LLM-as-judge grade, and no benefit awarded merely for obeying Harness rituals.

Agent syntax errors, repeated failed tools and budget/time exhaustion count as
failures. Build outages, unavailable model access and broken graders are separately
reported infrastructure failures. At most one symmetric, fresh-pair retry is
allowed for verified infrastructure failures; retain all attempted-run costs.
Never exclude a valid agent failure because it makes one arm look worse.

## Usage, time, and reporting

Each task/arm/repeat row records: **completion, input, output, cached input,
cache-write tokens if exposed, USD cost, and agent wall-clock seconds**. Also keep
setup, verifier and total elapsed time separately; parallel child durations are
not added to compute wall-clock time. Include every parent, worker, reviewer,
retry and failed request inside the episode. Keep research/orchestrator overhead
outside trial cost and report it separately if measured.

Preserve request-level usage and timestamps, trajectories, prompt/fixture/config
hashes, final diffs, loaded-surface audits, and external verifier logs. Deduplicate
cumulative counters and request IDs. Input may already include cached tokens;
reasoning tokens may already be included in output. Preserve provider semantics
and avoid double counting. Missing cache-write or billing telemetry is `unknown`,
not zero. A price-derived API-equivalent estimate must be labeled separately from
actual billed cost, with its pricing source and date.

Report success rates first, then cost/time for all attempts and for successes
separately. Show cost per accepted task, medians and raw rows. A cheaper failed
run is not evidence of improved efficiency. Aggregate failure costs transparently.
If no task succeeds, cost per accepted task is undefined.

Use paired success-rate differences and task-clustered bootstrap 95% intervals;
repeated episodes are not independent new tasks. Our proposed minimum meaningful
effect is **10 percentage points**, a local decision threshold, not a published
standard. Apply the paired contract's interval decision rule. With only nine
selected tasks, this is a low-power pilot: report uncertainty and do not promote
a favorable point estimate to a general effectiveness claim.

## Scope and readiness

This document defines the next baseline; it supplies no fresh performance result.
The existing paired runner documents OpenCode/Claude engines, not a ready Luna
Codex adapter. Before execution, verify a same-host Luna launcher, delegation
parity, complete usage telemetry and Linux fixture/verifier integration. Freeze
the CLI/image/model/Harness commits, token/cost caps and activated-test hashes in
the run manifest. Do not start trials while those values are unresolved.

[SWE-bench Verified's published audit](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
reports flawed tests in an audited difficult subset and contamination evidence;
it is not our sole next-run standard. This does not imply all SWE-bench tasks are
invalid or that the public sources selected here are contamination-free.
