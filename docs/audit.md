# Harness System Audit Log

Maintainer-facing audit record. If you just want to know whether Harness works and how to verify it yourself, start at [VERIFICATION.md](../VERIFICATION.md) instead — this file records *how the scores below were obtained* and what changed between audit cycles.

> **Historical snapshot boundary:** the scorecard below is the 2026-09-01 audit and is intentionally preserved as evidence of what was measured on that date. Platform capabilities have changed since then (including the OpenAI/Codex local plugin work and the OpenCode plugin implementation). Do not treat the 2026-09-01 platform rows as current-state documentation; use [platform-capabilities.md](platform-capabilities.md) for the current matrix.

**Last self-audited: 2026-09-01**, by running the actual test suite and the VERIFICATION.md recipes on Windows 11 — not by reading the code and assuming it works.

## The 2026-07-23 mis-measurement incident

Seven independent AI-model audits (Gemini 3.1 Pro, Gemini 3.5 Flash, GPT/Copilot on Mistral Medium/Small, and others) ran the same week and disagreed sharply on whether core hooks even functioned. Three of them tested `rule-of-3.js`, `boundary-guard.js`, and `state-persist.js` by piping JSON through `echo '...' | node script.js` in Windows Git Bash, which mangles stdin/TTY state and produced false "broken" verdicts. Re-running the identical payloads through Node's own `child_process` stdin API (the technique VERIFICATION.md's recipes now use) showed every one of those mechanisms working exactly as documented — the scores below reflect that corrected, verified state, not the average of the seven reports.

This incident is why VERIFICATION.md's recipes were rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe), and why the §2 mechanism checks were automated as `ci/mechanism-test.js` (`npm run test:mechanism`) — copy-paste recipes that can be mis-executed are not a reliable verification substrate.

## Five Core Verification Criteria (per VERIFICATION.md §5a)

| Criterion | Score | Verified basis |
|---|---|---|
| **Skill Description Completeness** | 10/10 | All 26 skill directories present in the 2026-09-01 snapshot had a complete four-row Skill Contract and the required trigger sections. Four PreToolUse hooks remained internal mechanisms, not standalone skills. |
| **Routing Accuracy** | 9/10 | The local router passed 34/34 positive prompts across all 26 skills in that snapshot, including the foundation and meta routes added in the audit. Waza verification was not runnable in that Windows checkout; ambiguous/metaphorical generalization remained unmeasured. |
| **Test Coverage of All Skills** | 9.5/10 | `npm test` included syntax, CLI, routing matrix, positive route coverage, references, behavioral-case structure, Fable contract, and mechanism checks at the time. Waza and live model sessions remained separate CI/on-demand evidence. |
| **Configuration Balance** | 8.5/10 | **Historical 2026-09-01 result:** hard `exit(2)` blocking hooks were measured on Claude Code and the other then-installed platform paths were evaluated as advisory. This row predates the later OpenAI/Codex local plugin and OpenCode plugin work; see `docs/platform-capabilities.md` for current status. |
| **Workflow Conformance** | 8.5/10 | Every skill in the snapshot had a matching workflow document, and `ci/skill-routing-check.js` executed every positive route case against the real router. Runtime tool-call sequence conformance remained host-dependent and was not claimed. |

## Overall Scorecard

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
