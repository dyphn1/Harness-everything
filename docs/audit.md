# Harness System Audit Log

Maintainer-facing audit record. If you just want to know whether Harness works and how to verify it yourself, start at [VERIFICATION.md](../VERIFICATION.md) instead — this file records *how the scores below were obtained* and what changed between audit cycles.

**Last self-audited: 2026-09-01**, by running the actual test suite and the VERIFICATION.md recipes on Windows 11 — not by reading the code and assuming it works.

## The 2026-07-23 mis-measurement incident

Seven independent AI-model audits (Gemini 3.1 Pro, Gemini 3.5 Flash, GPT/Copilot on Mistral Medium/Small, and others) ran the same week and disagreed sharply on whether core hooks even functioned. Three of them tested `rule-of-3.js`, `boundary-guard.js`, and `state-persist.js` by piping JSON through `echo '...' | node script.js` in Windows Git Bash, which mangles stdin/TTY state and produced false "broken" verdicts. Re-running the identical payloads through Node's own `child_process` stdin API (the technique VERIFICATION.md's recipes now use) showed every one of those mechanisms working exactly as documented — the scores below reflect that corrected, verified state, not the average of the seven reports.

This incident is why VERIFICATION.md's recipes were rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe), and why the §2 mechanism checks were automated as `ci/mechanism-test.js` (`npm run test:mechanism`) — copy-paste recipes that can be mis-executed are not a reliable verification substrate.

## Five Core Verification Criteria (per VERIFICATION.md §5a)

| Criterion | Score | Verified basis |
|---|---|---|
| **Skill Description Completeness** | 10/10 | All 26 current skill directories have a complete four-row Skill Contract and the required trigger sections. Four PreToolUse hooks remain internal mechanisms, not standalone skills. |
| **Routing Accuracy** | 9/10 | The local router passes 34/34 positive prompts across all 26 skills, including the foundation and meta routes added in this audit. Waza verification is not runnable in this Windows checkout; ambiguous/metaphorical generalization remains unmeasured. |
| **Test Coverage of All Skills** | 9.5/10 | `npm test` now includes syntax, CLI, routing matrix, positive route coverage, references, behavioral-case structure, Fable contract, and mechanism checks. Waza and live model sessions remain separate CI/on-demand evidence. |
| **Configuration Balance** | 8.5/10 | Confirmed asymmetric-by-design: hard `exit(2)` blocking hooks on Claude Code, advisory-only text on the other five platforms, with `self-heal.js` auto-repairing missing integration files on every platform. No platform is either silently ignored or over-blocked. |
| **Workflow Conformance** | 8.5/10 | Every current skill has a matching workflow document, and `ci/skill-routing-check.js` executes every positive route case against the real router. Runtime tool-call sequence conformance remains host-dependent and is not claimed. |

## Overall Scorecard

| Category | Score | Notes |
|---|---|---|
| **Architecture** | 9/10 | Per-session state isolation, per-platform state directories, fail-open-by-default hooks — all re-verified directly against `hooks/scripts/lib/harness-state.js`. |
| **Test Coverage** | 9/10 | See above — deterministic checks now cover syntax, routing, skill references, release-tag catalog, install tree/version drift, behavioral-case structure, and 12 mechanism suites. Live model evaluation remains on-demand and is not represented by a local simulation. |
| **README Completeness** | 9.5/10 | Catalog counts, layer labels, route coverage, and the local baseline now match the current 26-skill tree. |
| **Maintainability** | 9/10 | The custom cross-session todo CLI and obsolete multi-agent compatibility stubs are absent; route coverage is now a deterministic regression gate. |
| **Skills Design** | 9.5/10 | All 26 current skills use the same four-row Skill Contract and exact trigger-section contract; internal hooks remain intentionally non-routable. |
| **Agent Compatibility** | 9/10 | Full hard-mechanism support on Claude Code; verified advisory-text fallback on the other five platforms via `docs/architecture.md` and `scripts/installer.js`. |
| **Beginner Friendliness** | 7.5/10 | Quick Start is genuinely 10 seconds, but Tier Routing / Rule of 3 / session-scoped state are load-bearing concepts a newcomer has to absorb before the system's behavior makes sense. Not addressed this round. |

## Change log by audit cycle

### 2026-09-01
- Fable v3 integration now exposes explicit Haiku, Sonnet, and Opus entrypoints, with deterministic model selection and visible inline fallback or blocked escalation in `fable-mode/model-matrix.json` and `fable-mode/scripts/model-selector.js`.
- The current workflow uses native host TODO tracking or Markdown checklists. The older shared TODO CLI/state-machine references below are retained only as historical audit evidence; no runtime, test, or active workflow depends on them.
- Strict catalog audit: removed obsolete compatibility directories and stale workflow; added the missing `find-skills` workflow.
- Corrected current documentation and runtime references to the per-session `.claude/harness-everything/state/` path, aligned README/registry layer labels, and removed unimplemented workflow claims.
- Added `ci/skill-routing-check.js`; all 34 positive routing cases across the 26-skill catalog pass locally, and all positive eval descriptions now exactly match their skill frontmatter.

### 2026-07-26
- `verify-gate.js` is no longer a simulated stub: it now discovers the nearest `package.json` (scoped to the enclosing git repo), runs its real `lint`/`test` scripts via the detected package manager (npm/pnpm/yarn/bun), and blocks completion on any failure. The `.verify-fail.tmp` injection hook is kept for hermetic mechanism tests, and `HARNESS_SKIP_PROJECT_CHECKS=1` guards against self-recursion in projects (like this one) whose test suite itself drives the Harness runtime. When no runnable scripts exist it exits 0 but explicitly warns that no mechanical checks ran — the exit code is not evidence.
- CI added: `.github/workflows/ci.yml` runs `npm test` on push/PR, closing the "local-gate-only" gap called out in the previous cycle.
- README restructured to be user-facing (problem → quick start → what gets installed/uninstall → platform support); audit narrative moved to this file.
- `harness-everything/SKILL.md`: tier-router output wording and the Skill Contract now agree (router output is the default route, overridable with a one-line reason — previously the contract said "MUST follow" while the script itself said "default, not an order"); section numbering fixed (§5 registry now precedes §6).

### 2026-07-23
- VERIFICATION.md §2's mechanism checks automated (`npm run test:mechanism`).
- VERIFICATION.md's test recipes rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe).
- Workflow progress is recorded in the host TODO tracker or a Markdown checklist.
