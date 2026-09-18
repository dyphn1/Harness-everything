# Harness System Audit Log

Maintainer-facing audit record. If you just want to know whether Harness works and how to verify it yourself, start at [VERIFICATION.md](../VERIFICATION.md) instead — this file records *how the scores below were obtained* and what changed between audit cycles.

> **Historical snapshot boundary:** the scorecards below are dated audits and are intentionally preserved as evidence of what was measured on each date. Platform capabilities have changed since the 2026-09-01 snapshot (including the OpenAI/Codex local plugin work and the OpenCode plugin implementation). Do not treat any dated platform row as current-state documentation; use [platform-capabilities.md](platform-capabilities.md) for the current matrix.

**Last self-audited: 2026-09-18**, by running the deterministic test suite and gates on macOS (Node.js 24.14.1) — not by reading the code and assuming it works. The 2026-09-01 Windows 11 snapshot is preserved below. Live-host and behavioral evidence layers were not re-run in this cycle; retained artifacts are referenced, not re-measured.

## The 2026-09-18 audit cycle

Measured on `docs/sync-skills-and-mechanisms` at `45f2123` (docs-only delta over v0.11.6): 26/26 on-disk canonical skills, 26/26 routing-eval directories (`evals/` also holds `evaluation-reports.md`), and the following gate results:

| Gate | Result on 2026-09-18 |
|---|---|
| `npm test` (self-regression, 43 passing checks) | Green except one pre-existing failure: `mechanism-30-opencode-plugin-loadability`, reproduced on the clean tree and caused by leftover `.worktrees/docs-skill-catalog` fixtures asserting `.mjs` destinations — not by product code |
| `npm run test:mutations` | Passed: 8 production mutations rejected by focused tests |
| `npm run test:consistency` (incl. doc-capability + repo-contract) | Passed |
| `npm run test:references` | Passed: 66 skill path references resolve across 26 skills |
| `npm run test:collision` | Passed: no description collisions at 0.75 threshold |
| `npm run test:routing:skills` | Passed: 34 positive cases across 26 direct skills; 4 nested skills classified |
| `npm run test:routing:invariants` | Passed: 275 checks, 0 failures (incl. workflow execution enforcement) |
| `node ci/disclosure-check.js` | Passed: 26 skills, 26 workflow docs |
| `npm run test:plugin:openai` / `test:plugin:submission` / `test:platform:compatibility` / `test:release` | All passed; release catalog green for v0.11.6 at 26/26 |
| `waza tokens check` | All 26 canonical skills within the 500-token limit; the single exceedance is the intentional `eval-framework/fixtures/over-budget-skill` negative control (855 tokens, exists to exercise the failure path) |

Since the 2026-09-01 snapshot, the product gained the mandatory-workflow contract (#142), runtime budget enforcement (#143), structured action gate (#144), memory governance (#145), self-evolve closed loop (#146), telemetry core (#147), contract-integrity phase 1 (#148), workflow controller recovery and isolation hardening (#150/#152/#154/#156/#158), observed-mutation accounting (#160), the Codex local plugin plus Claude certification boundary (#123), OpenCode `.js` loadability guard and partial live-host evidence (#128/#129), and the paired-benchmark contract (#130) — all covered by deterministic mechanism tests. The docs lag this cycle closed: stale `docs/workflows` rewrites, the README index gaps, and the previously undocumented ensemble/memory/guard/probe mechanisms are synced in the same change as this audit entry.

## Five Core Verification Criteria — 2026-09-18 re-measurement

| Criterion | Score | Verified basis |
|---|---|---|
| **Skill Description Completeness** | 10/10 | 26/26 skill directories carry complete frontmatter and the required trigger sections, verified by the consistency gate in this cycle. Internal hooks remain intentionally non-routable. |
| **Routing Accuracy** | 9/10 | 34/34 positive prompts across all 26 skills plus 275/275 invariant-routing checks in this cycle. Waza generalization (ambiguous/metaphorical prompts) and live model sessions remain unmeasured. |
| **Test Coverage of All Skills** | 9.5/10 | Self-regression now spans syntax, CLI, routing matrix, positive route coverage, invariant routing, references, behavioral-case structure, Fable contract, mutations, and 40+ mechanism suites. Waza full-matrix verify and live sessions remain separate on-demand evidence; `mechanism-30` is red only where the stale `.worktrees` leftover exists. |
| **Configuration Balance** | 9/10 | Hard `exit(2)` blocking hooks on Claude Code, mechanism-tested local Codex plugin package, and partial OpenCode live-host evidence (project `.js` scope, 1.18.31 macOS) — all centralized in `docs/platform-capabilities.md`. Live parity beyond the retained artifacts is still unclaimed. |
| **Workflow Conformance** | 9/10 | 26/26 skills have matching workflow documents (two stale ones rewritten in this cycle), the selected-workflow contract with escape/budget/stop-gate semantics is mechanism-tested, and disclosure passes. Runtime tool-call sequence conformance remains host-dependent and is not claimed. |

## Overall Scorecard — 2026-09-18

| Category | Score | Notes |
|---|---|---|
| **Architecture** | 9/10 | Per-session state isolation, worktree-gated Tier 3 mutation, per-tool mutation probes settled in one ordered handler, and single-use memory capabilities — all mechanism-tested in this cycle. |
| **Test Coverage** | 9.5/10 | 43 passing self-regression checks, 8/8 mutations rejected, 66/66 references resolve. Live model evaluation remains on-demand and is not represented by a local simulation. |
| **README Completeness** | 9.5/10 | Catalog counts, layer labels, route coverage, and the 26-skill tree match after this cycle's index fix (`contract-integrity`/`telemetry`/`eval-framework` rows added). |
| **Maintainability** | 9/10 | ~600 commits across 20+ PRs since 09-01 landed without breaking the consistency/release/disclosure gates; new non-skill directories are documented as non-skills rather than left ambiguous. |
| **Skills Design** | 9.5/10 | All 26 skills keep the Skill Contract format, `USE FOR`/`DO NOT USE FOR` sections, and the 500-token limit (verified by waza in this cycle); internal hooks remain intentionally non-routable. |
| **Agent Compatibility** | 9/10 | Claude hard-mechanism support measured, Codex local plugin mechanism-tested, OpenCode partial live evidence retained — see the current platform matrix, not this row, for status. |
| **Beginner Friendliness** | 7.5/10 | Unchanged since 09-01: Tier Routing / Rule of 3 / session-scoped state remain load-bearing concepts. The two rewritten workflow docs reduce stale-doc confusion but add no onboarding track. Not addressed in this audit round. |

## The 2026-07-23 mis-measurement incident (preserved)

Seven independent AI-model audits (Gemini 3.1 Pro, Gemini 3.5 Flash, GPT/Copilot on Mistral Medium/Small, and others) ran the same week and disagreed sharply on whether core hooks even functioned. Three of them tested `rule-of-3.js`, `boundary-guard.js`, and `state-persist.js` by piping JSON through `echo '...' | node script.js` in Windows Git Bash, which mangles stdin/TTY state and produced false "broken" verdicts. Re-running the identical payloads through Node's own `child_process` stdin API (the technique VERIFICATION.md's recipes now use) showed every one of those mechanisms working exactly as documented — the scores below reflect that corrected, verified state, not the average of the seven reports.

This incident is why VERIFICATION.md's recipes were rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe), and why the §2 mechanism checks were automated as `ci/mechanism-test.js` (`npm run test:mechanism`) — copy-paste recipes that can be mis-executed are not a reliable verification substrate.

## Five Core Verification Criteria — 2026-09-01 snapshot (per VERIFICATION.md §5a)

| Criterion | Score | Verified basis |
|---|---|---|
| **Skill Description Completeness** | 10/10 | All 26 skill directories present in the 2026-09-01 snapshot had a complete four-row Skill Contract and the required trigger sections. Four PreToolUse hooks remained internal mechanisms, not standalone skills. |
| **Routing Accuracy** | 9/10 | The local router passed 34/34 positive prompts across all 26 skills in that snapshot, including the foundation and meta routes added in the audit. Waza verification was not runnable in that Windows checkout; ambiguous/metaphorical generalization remained unmeasured. |
| **Test Coverage of All Skills** | 9.5/10 | `npm test` included syntax, CLI, routing matrix, positive route coverage, references, behavioral-case structure, Fable contract, and mechanism checks at the time. Waza and live model sessions remained separate CI/on-demand evidence. |
| **Configuration Balance** | 8.5/10 | **Historical 2026-09-01 result:** hard `exit(2)` blocking hooks were measured on Claude Code and the other then-installed platform paths were evaluated as advisory. This row predates the later OpenAI/Codex local plugin and OpenCode plugin work; see `docs/platform-capabilities.md` for current status. |
| **Workflow Conformance** | 8.5/10 | Every skill in the snapshot had a matching workflow document, and `ci/skill-routing-check.js` executed every positive route case against the real router. Runtime tool-call sequence conformance remained host-dependent and was not claimed. |

## Overall Scorecard — 2026-09-01 snapshot

| Category | Score | Notes |
|---|---|---|
| **Architecture** | 9/10 | Per-session state isolation, per-platform state directories, fail-open-by-default hooks — all re-verified directly against `hooks/scripts/lib/harness-state.js` in the 2026-09-01 audit. |
| **Test Coverage** | 9/10 | Deterministic checks covered syntax, routing, skill references, release-tag catalog, install tree/version drift, behavioral-case structure, and 12 mechanism suites at the time. Live model evaluation remained on-demand and was not represented by a local simulation. |
| **README Completeness** | 9.5/10 | Catalog counts, layer labels, route coverage, and the local baseline matched the then-current 26-skill tree. |
| **Maintainability** | 9/10 | The custom cross-session todo CLI and obsolete multi-agent compatibility stubs were absent; route coverage was a deterministic regression gate. |
| **Skills Design** | 9.5/10 | All 26 skills in the snapshot used the same four-row Skill Contract and exact trigger-section contract; internal hooks remained intentionally non-routable. |
| **Agent Compatibility** | 9/10 | **Historical 2026-09-01 result:** full hard-mechanism support was measured on Claude Code and advisory fallback on the other installer targets then covered by the audit. This is not the current platform matrix. |
| **Beginner Friendliness** | 7.5/10 | Quick Start was genuinely 10 seconds, but Tier Routing / Rule of 3 / session-scoped state were load-bearing concepts a newcomer had to absorb before the system's behavior made sense. Not addressed in that audit round. |

## Change log by audit cycle

### 2026-09-18
- Re-measured the deterministic suite and gates on macOS (Node.js 24.14.1): 43 passing self-regression checks, 8/8 mutations rejected, 66/66 references resolve, 34/34 positive routes, 275/275 invariant checks, disclosure 26/26, release catalog green for v0.11.6. Sole red is the pre-existing `mechanism-30` failure from leftover `.worktrees/docs-skill-catalog` fixtures, reproduced on the clean tree.
- Closed the docs lag accumulated since 09-01 in the same change: rewrote the stale `docs/workflows/harness-everything.md` and `install-cognitive-os.md`, added the missing README index rows (`contract-integrity`/`telemetry`/`eval-framework`), and documented the ensemble policy, single-use memory capability, guard trio, and mutation-probe lifecycle in `docs/architecture.md` / `docs/workflow-runtime.md`.
- Product changes since 09-01 now covered by mechanism tests: mandatory-workflow contract, budget enforcement, structured action gate, memory governance, self-evolve closed loop, telemetry core, contract-integrity phase 1, controller recovery/isolation hardening, observed-mutation accounting, Codex local plugin, OpenCode partial live evidence, paired-benchmark contract. Live-host and behavioral layers were not re-run; retained artifacts stand.
- Beginner Friendliness stays 7.5/10: still no onboarding track. Candidate for the next cycle.

### 2026-09-01
- Fable v3 integration exposed explicit Haiku, Sonnet, and Opus entrypoints, with deterministic model selection and visible inline fallback or blocked escalation in `fable-mode/model-matrix.json` and `fable-mode/scripts/model-selector.js`.
- The workflow used native host TODO tracking or Markdown checklists. The older shared TODO CLI/state-machine references below are retained only as historical audit evidence; no current runtime, test, or active workflow depends on them.
- Strict catalog audit: removed obsolete compatibility directories and stale workflow; added the missing `find-skills` workflow.
- Corrected documentation and runtime references to the per-session `.claude/harness-everything/state/` path, aligned README/registry layer labels, and removed unimplemented workflow claims.
- Added `ci/skill-routing-check.js`; all 34 positive routing cases across the 26-skill catalog passed locally, and all positive eval descriptions exactly matched their skill frontmatter.

### 2026-07-26
- `verify-gate.js` was no longer a simulated stub: it discovered the nearest `package.json` (scoped to the enclosing git repo), ran its real `lint`/`test` scripts via the detected package manager (npm/pnpm/yarn/bun), and blocked completion on failure. The `.verify-fail.tmp` injection hook was kept for hermetic mechanism tests, and `HARNESS_SKIP_PROJECT_CHECKS=1` guarded against self-recursion in projects whose test suite itself drove the Harness runtime. When no runnable scripts existed it exited 0 but explicitly warned that no mechanical checks ran — the exit code was not evidence.
- CI added: `.github/workflows/ci.yml` ran `npm test` on push/PR, closing the "local-gate-only" gap called out in the previous cycle.
- README restructured to be user-facing (problem → quick start → what gets installed/uninstall → platform support); audit narrative moved to this file.
- `harness-everything/SKILL.md`: tier-router output wording and the Skill Contract were aligned (router output is the default route, overridable with a one-line reason — previously the contract said "MUST follow" while the script itself said "default, not an order"); section numbering fixed (§5 registry now precedes §6).

### 2026-07-23
- VERIFICATION.md §2's mechanism checks automated (`npm run test:mechanism`).
- VERIFICATION.md's test recipes rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe).
- Workflow progress was recorded in the host TODO tracker or a Markdown checklist.
