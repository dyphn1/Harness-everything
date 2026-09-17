# PR #142 / issue #131 completion review

This review covers the implementation in the commit containing this report,
starting from PR head `8b99baec44745e171f078fe9eb3dac6fd812b5c8`. It evaluates
Harness engineering and the latest #131 decision, including mandatory mutation
isolation. It is not a measured agent-performance benchmark.

## Findings resolved

| Original gap | Delivered behavior | Regression evidence |
| --- | --- | --- |
| Escape changed the whole workflow state and skipped isolation | Stage-scoped escape; isolation survives legacy escape and blocked states | `mechanism-2af-worktree-isolation.test.js`, `mechanism-2ah-workflow-lifecycle.test.js` |
| Only cwd was checked | Registered linked checkout of the bound repo; direct/patch targets, move destinations, traversal, and links checked | `mechanism-2af-worktree-isolation.test.js` |
| Windows runner used 8.3 paths while Git reported long names | Native physical-path resolution equates both spellings without relaxing isolation | Windows path regression and worktree suites |
| Read-only shell prefixes accepted writes | Reject redirects, substitutions, chained commands and dangerous options; require isolated cwd for mutation/unknown commands | `mechanism-2af-worktree-isolation.test.js` |
| Next prompt erased unresolved obligations | Stable workflow identity across steering prompts; stronger route requires replan | `mechanism-2ah-workflow-lifecycle.test.js` |
| Same strategy/timestamp loosely matched any Fable run | Exact workflow, session and run correlation | `mechanism-2ah-workflow-lifecycle.test.js` |
| Entry gate blocked its own bootstrap path | One bounded stage-specification file and trusted start controller; state/source writes remain gated | `mechanism-2ah-workflow-lifecycle.test.js` |
| Stop trusted directory contents and pass labels | Expected manifest stages, correlated exit-zero evidence, worker attribution and fresh verifier required | `mechanism-2ah-workflow-lifecycle.test.js` |
| Stop retry silently passed unresolved work | Retry records blocked; no satisfied state without required evidence | `mechanism-2ah-workflow-lifecycle.test.js` |
| Failures could not recover cleanly | Observed fail-to-pass checks; explicit bounded replan; retained prior run evidence | `mechanism-2ah-workflow-lifecycle.test.js` |
| Runtime policy scraped human-readable output | Kernel imports the structured core result; complete invariants persist with the plan | routing tests and lifecycle tests |
| Current documents contradicted the PR | README, platform matrix, routing, architecture, Fable/worktree references and mirrors aligned | consistency/capability/reference gates |
| Existing CI selected the first matching hook group | Action-gate regression finds its actual adapter among shared tool matchers | `ci/action-gate.test.js` |

The first added isolation regression run failed 16 assertions against the PR
baseline, then passed after repair. The baseline's four failing GitHub CI jobs
also reported the action-gate matcher defect. The initial local checkout lacked
dependencies, producing a separate CRLF-fixture setup failure; `npm ci` resolved
that environment prerequisite.

## Verification

Local environment: Windows, PowerShell, Node.js 24.15.0, npm 11.12.1. Work was
performed in an isolated linked worktree; the primary checkout remained clean.

All 14 required gate categories passed: `npm test`, mutations, mechanism,
consistency, repository contract, capability docs, references, release,
collision, positive skill routing, routing invariants, OpenAI package/runtime,
public submission, and platform compatibility. Failed checks were corrected and
the affected gates rerun. The final `npm test` includes **44 mechanism suites**.

The new lifecycle suite exercises **50 assertions against source and the same
50 against the packaged OpenAI layout**, using actual child processes, Git
repositories, worktrees, controller commands and hook payloads. Host payloads
are fixtures: these are deterministic mechanism tests, not live agent sessions.

Waza passed 30 canonical/nested skill readiness checks, 26 routing-spec checks,
and token validation (57 successful commands). Positive routing covered 34
cases across 26 direct skills and classified four nested skills.

Build/types/lint have no separate project scripts; repository syntax and
consistency gates apply. No coverage percentage is claimed. The security scanner
reported 12 pre-existing documentation/test-pattern matches, including its own
patterns and an explicitly fake token fixture; changed production code added no
scanner findings. `npm ci` reported zero dependency vulnerabilities. Diff review
and `git diff --check` passed. See the retained [gate summary](../../benchmarks/results/reviews/pr142-verification.json).

Remote CI is a separate evidence layer. Its result must be read at the final PR
head; this local record does not assert a future GitHub Actions outcome.

## Reassessment

Scores are review judgments about engineering readiness, each out of 100.
Each row has four equally weighted criteria (25 points each), with the observed
deductions shown. They are not success probabilities or benchmark results.

| Dimension | Criteria scores | Total | Remaining deductions |
| --- | --- | ---: | --- |
| Contract coherence | entry 22, transitions 23, scoped exceptions 24, docs 23 | 92 | Skill applicability and iterative budgets still partly rely on executor compliance |
| Mutation safety | worktree identity 23, targets 23, shell handling 17, state trust 12 | 75 | Arbitrary script effects need a host sandbox; runtime state is agent-writable |
| Deterministic verification | gate breadth 25, negative cases 24, package parity 24, evidence checks 18 | 91 | Host-shaped fixtures cannot establish real host behavior or semantic check quality |
| Operation and maintenance | entry/recovery 22, modularity 21, distribution 23, diagnostics/migration 18 | 84 | Manual stage setup, missing-metadata blocks and legacy-state repair add operator work |

Equal-weight engineering score: **85.5/100** (approximately **86/100**).
The system now has substantially stronger tested lifecycle and isolation
contracts. It is suitable for further host validation with explicit boundaries.

**Live-host reliability of these new gates remains unverified. Behavioral gain
from this PR remains unmeasured.** Neither receives an invented effectiveness
score. Older retained OpenCode evidence and older behavioral cases cannot prove
this workflow change. This review does not claim superiority over other skill
collections, reduced token cost, or improved task success rates.

The next evidence needed is a retained Claude/Codex session showing routing,
entry, mutation denial/allow, numeric stage results, worker correlation and Stop
resolution; then paired same-model/same-task behavioral runs. OpenCode needs its
own adapter before parity can be claimed. See [runtime limits](../workflow-runtime.md)
and [platform capabilities](../platform-capabilities.md).
