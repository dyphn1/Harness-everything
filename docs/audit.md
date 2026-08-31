# Harness System Audit Log

Maintainer-facing audit record. If you just want to know whether Harness works and how to verify it yourself, start at [VERIFICATION.md](../VERIFICATION.md) instead — this file records *how the scores below were obtained* and what changed between audit cycles.

**Last self-audited: 2026-07-23**, by running the actual test suite and the VERIFICATION.md recipes on Windows 11 — not by reading the code and assuming it works.

## The 2026-07-23 mis-measurement incident

Seven independent AI-model audits (Gemini 3.1 Pro, Gemini 3.5 Flash, GPT/Copilot on Mistral Medium/Small, and others) ran the same week and disagreed sharply on whether core hooks even functioned. Three of them tested `rule-of-3.js`, `boundary-guard.js`, and `state-persist.js` by piping JSON through `echo '...' | node script.js` in Windows Git Bash, which mangles stdin/TTY state and produced false "broken" verdicts. Re-running the identical payloads through Node's own `child_process` stdin API (the technique VERIFICATION.md's recipes now use) showed every one of those mechanisms working exactly as documented — the scores below reflect that corrected, verified state, not the average of the seven reports.

This incident is why VERIFICATION.md's recipes were rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe), and why the §2 mechanism checks were automated as `ci/mechanism-test.js` (`npm run test:mechanism`) — copy-paste recipes that can be mis-executed are not a reliable verification substrate.

## Five Core Verification Criteria (per VERIFICATION.md §5a)

| Criterion | Score | Verified basis |
|---|---|---|
| **Skill Description Completeness** | 8.5/10 | 23 of 27 skills/hooks have a full Skill Contract `SKILL.md` (trigger, output, state mutations, enforcement gate). Four PreToolUse hooks — `depth-guard.js`, `context-compact.js`, `atomic-commit-check.js`, `contract-test.js` — are only described in passing in `docs/architecture.md`, not as standalone contracts. Known, not yet closed. |
| **Routing Accuracy** | 8.5/10 | `tier-router.js` is a deterministic, bilingual (EN/中文) heuristic. The 12-case adversarial matrix now scores 12/12 (100%) with 100% explicit macro recall, including one-sentence audits, benchmarks, four-issue audits, and Chinese prompts. Ambiguous/metaphorical prompts remain an unmeasured generalization risk; no effectiveness claim follows from this routing matrix. |
| **Test Coverage of All Skills** | 9.0/10 | `npm test` runs deterministic syntax, routing, reference, behavioral-case, install-drift, and mechanism checks. Live model sessions are separate and token-costing, so a local simulation cannot masquerade as model evidence. |
| **Configuration Balance** | 8.5/10 | Confirmed asymmetric-by-design: hard `exit(2)` blocking hooks on Claude Code, advisory-only text on the other five platforms, with `self-heal.js` auto-repairing missing integration files on every platform. No platform is either silently ignored or over-blocked. |
| **Workflow Conformance** | 7/10 | `docs/workflows/` diagrams (TDD, git-commit, agent-launcher, architecture refactor) are accurate and the tier-router recommends the full skill chain for each, confirmed live. What's still missing is a *runtime* check that an agent's actual tool-call sequence matched the diagram — today that's compliance-by-convention, not compliance-by-mechanism. Not attempted this round; it's a larger feature, not a fix. |

## Overall Scorecard

| Category | Score | Notes |
|---|---|---|
| **Architecture** | 9/10 | Per-session state isolation, per-platform state directories, fail-open-by-default hooks — all re-verified directly against `hooks/scripts/lib/harness-state.js`. |
| **Test Coverage** | 9/10 | See above — deterministic checks now cover syntax, routing, skill references, release-tag catalog, install tree/version drift, behavioral-case structure, and 12 mechanism suites. Live model evaluation remains on-demand and is not represented by a local simulation. |
| **README Completeness** | 9/10 | Audit detail now lives here rather than in the README itself, keeping the README user-facing. |
| **Maintainability** | 8.5/10 | The custom cross-session todo CLI was removed; complex work now uses the host agent's native tracker or a workspace Markdown checklist, reducing a second state machine and its drift surface. |
| **Skills Design** | 8.5/10 | Consistent Skill Contract format; four hooks still pending one (see above). |
| **Agent Compatibility** | 9/10 | Full hard-mechanism support on Claude Code; verified advisory-text fallback on the other five platforms via `docs/architecture.md` and `scripts/installer.js`. |
| **Beginner Friendliness** | 7.5/10 | Quick Start is genuinely 10 seconds, but Tier Routing / Rule of 3 / session-scoped state are load-bearing concepts a newcomer has to absorb before the system's behavior makes sense. Not addressed this round. |

## Change log by audit cycle

### 2026-07-26
- `verify-gate.js` is no longer a simulated stub: it now discovers the nearest `package.json` (scoped to the enclosing git repo), runs its real `lint`/`test` scripts via the detected package manager (npm/pnpm/yarn/bun), and blocks completion on any failure. The `.verify-fail.tmp` injection hook is kept for hermetic mechanism tests, and `HARNESS_SKIP_PROJECT_CHECKS=1` guards against self-recursion in projects (like this one) whose test suite itself drives the Harness runtime. When no runnable scripts exist it exits 0 but explicitly warns that no mechanical checks ran — the exit code is not evidence.
- CI added: `.github/workflows/ci.yml` runs `npm test` on push/PR, closing the "local-gate-only" gap called out in the previous cycle.
- README restructured to be user-facing (problem → quick start → what gets installed/uninstall → platform support); audit narrative moved to this file.
- `harness-everything/SKILL.md`: tier-router output wording and the Skill Contract now agree (router output is the default route, overridable with a one-line reason — previously the contract said "MUST follow" while the script itself said "default, not an order"); section numbering fixed (§5 registry now precedes §6).

### 2026-07-23
- VERIFICATION.md §2's mechanism checks automated (`npm run test:mechanism`).
- VERIFICATION.md's test recipes rewritten to be Windows-safe (`node -e` stdin instead of a shell `echo` pipe).
