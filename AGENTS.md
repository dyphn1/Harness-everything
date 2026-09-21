---
description: Operating guide for AI agents working inside the Harness-everything repository — layout, change rules, quality gates, and release policy.
---

# AGENTS.md — Working in This Repository

You are modifying **Harness**: an orchestrated agent operating system (skills + hooks/plugins + routing) for AI coding agents. Changes here ship to real agent sessions; a vague `SKILL.md`, stale manifest, contradictory platform claim, or selected workflow that remains bypassable can misroute other people's agents. Precision is the product.

## Repository Layout

| Path | What it is |
|---|---|
| `<skill-name>/SKILL.md` | One canonical skill per top-level directory. Frontmatter: `name`, `description`, `metadata.author`, `metadata.version`. |
| `hooks/` | Claude Code lifecycle hook scripts and shared mechanisms such as circuit breaker, workflow/action/scope guards, and stop gates. Do not infer that every host packages every hook. |
| `harness-everything/scripts/` | Runtime: kernel/tier routing, workflow contract, verification, bootstrap, self-heal. |
| `opencode-plugin/` | OpenCode native plugin implementation. Mechanism-tested, with partial live-host evidence for project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS); see the evidence boundary below. |
| `.agents/plugins/` + `plugins/harness-everything/` | Local OpenAI/Codex marketplace + `.codex-plugin` package with canonical skill copies and packaged session/prompt hooks. |
| `submission/openai/` | Public OpenAI Skills-only listing/test inputs. The public artifact does not include local `.codex-plugin` lifecycle hooks. |
| `evals/<skill>/` | Trigger/routing eval per skill (waza format). Required for every canonical routed skill. |
| `behavioral-evals/` | LLM-behavior cases run via headless CLI sessions and structurally validated by CI. |
| `benchmarks/` | BENCHMARK_SOP fixtures and recorded results. Evidence lives here or nowhere. |
| `.claude-plugin/` | Claude Code plugin distribution manifests. Must list exactly the on-disk canonical skills. |
| `docs/platform-capabilities.md` | Canonical current platform/install/enforcement/evidence matrix. |
| `docs/repository-contract.md` | Generated current-state Node/workflow/action/gate contract. Regenerate with `npm run docs:sync`; do not hand-edit. |
| `.nvmrc` | Primary development/CI Node runtime. `package.json#engines.node` remains the minimum supported runtime. |
| `docs/`, `references/` | Philosophy, architecture, workflow documentation, shared checklists. |

## OpenCode evidence boundary

The retained [OpenCode evidence](benchmarks/results/live-host/opencode-2026-09-16/README.md) supports project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS). The final snapshot is post-reset (`hardLock: false`, `count: 1`). Hard lock is only an interactive observation with no retained blocked-tool trace; reflection was operator-seeded, then agent-rewritten. Agent-controlled state deletion resets the breaker. Global scope, npm-package installation, and other OpenCode versions remain unverified.

## Non-Negotiable Change Rules

1. **Every canonical SKILL.md keeps ≤ 500 tokens** (hard CI gate) and must contain `## USE FOR:` and `## DO NOT USE FOR:`. Deep detail goes in references/guides.
2. **Descriptions are routing surfaces.** Differentiate neighboring skills deliberately; `test:collision` guards overlap.
3. **A new canonical skill ships with a routing eval.** Positive task `description:` must exactly match the skill frontmatter description.
4. **Release version policy:** normal PRs do not manually bump package/plugin versions. `semantic-release` owns stable SemVer and `scripts/sync-release-version.js` owns distribution synchronization. Nested sub-skills inherit their parent skill version.
5. **Distribution manifests are generated facts:** add/remove/rename changes must sync every copied/listed distribution. Run `npm run plugin:sync`, `npm run test:consistency`, and `npm run test:plugin:openai`.
6. **Platform capability claims are tested contracts.** Update `docs/platform-capabilities.md` with integration behavior changes. Package/mechanism evidence is not live-host evidence, and public Skills-only behavior does not include local lifecycle hooks.
7. **Runtime/workflow claims are generated facts.** `package.json`, `.nvmrc`, Dockerfile, and active workflows feed `scripts/repository-contract.js`; run `npm run docs:sync` after relevant changes.
8. **CHANGELOG.md keeps pending human-authored notes under `[Unreleased]`.** Semantic-release owns stable headings/tags/release notes.
9. **Conventional Commit type is release input.** Breaking→major; `feat`→minor; `fix`/`perf`/`refactor`/`build`/`revert`→patch; docs/test/ci/style/chore do not release by themselves.
10. **Selected workflow is a semantic contract; tactics remain flexible.** Suggested skills MUST be read/evaluated before omission; applicable skill core contracts MUST be followed, while not-applicable requires a flow-grounded reason. Selected-topology required obligations MUST resolve. Missing host evidence may produce reminders, not a persistent Harness lock.
11. **User-visible Harness Status is mandatory for non-trivial work.** Render one readable Markdown block headed `### 🚦 Harness Status`, with bullet-aligned bold `Current`, `Read / Evidence`, `Next`, plus optional `Risk / Blocked`; use nested evidence bullets when useful. Emit it before substantive execution, after major phases, on direction changes, during long work at meaningful boundaries, and before final completion. The routing checkpoint is internal source state, not a second user-facing block. This semantic MUST does not create a hard lock.
12. **Tier-3/Fable isolation disposition is mandatory before broad mutation.** Use/reuse a verified linked Git worktree, or record an explicit degraded fallback when isolation is unavailable or the user explicitly chooses to stay in place. Ordinary isolation SHOULD be used when it materially reduces collision/risk. Failure to isolate is a visible semantic gap, not a Harness-owned deadlock. See [workflow-runtime.md](docs/workflow-runtime.md).
13. **Use contract strength deliberately.** MUST = required semantic obligation; SHOULD = expected default with an evidence-based exception; MAY = optional optimization. Do not use recommend/prefer/advisory/guidance to weaken a MUST. See [philosophy.md](docs/philosophy.md#contract-strength-must--should--may).

## Verification Before You Claim Done

Run the gates that cover the same contract categories as CI:

```bash
npm test
npm run test:mutations
npm run test:mechanism
npm run test:consistency
npm run test:repo-contract
npm run test:docs:capabilities
npm run test:references
npm run test:release
npm run test:collision
npm run test:routing:skills
npm run test:routing:invariants
npm run test:plugin:openai
npm run test:plugin:submission
npm run test:platform:compatibility
```

If waza is installed (`~/bin/waza`), also run:

```bash
waza check <skill-dir>
waza spec verify <skill> evals/<skill>/eval.yaml --fail --threshold 1
waza tokens check
```

Node.js 24 is primary CI across Ubuntu/Windows/macOS; a Node.js 22 lane protects the supported minimum. See [docs/repository-contract.md](docs/repository-contract.md).

Do not report "it works" from code reading. State the evidence layer proved: package, deterministic mechanism, live host, or behavior.

## Behavioral & Benchmark Evidence

Deterministic mechanism tests prove the tested hook/plugin contract; they do **not** prove a real host loaded it or that behavior improved. For behavior:

- `node behavioral-evals/run.js run --engine opencode` (or `--engine claude`) — on-demand, token-costing.
- Weekly behavioral workflow validates case structure and runs live cases only when its runner has the required CLI.
- `node benchmarks/run.js scaffold <scenario>` → run both variants → `record` with evidence logs.

For a live-host enforcement claim, preserve a host/session artifact showing the mechanism loaded and fired. For an effectiveness claim, use the paired evidence discipline in #71 rather than inferring improvement from mechanism presence.
