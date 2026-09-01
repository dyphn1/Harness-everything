---
description: Operating guide for AI agents working inside the Harness-everything repository — layout, change rules, quality gates, and release policy.
---

# AGENTS.md — Working in This Repository

You are modifying **Harness**: an orchestrated agent operating system (skills + hooks + routing) for AI coding agents. Changes here ship to real agent sessions; a vague SKILL.md or a stale manifest misroutes other people's agents. Precision is the product.

## Repository Layout

| Path | What it is |
|---|---|
| `<skill-name>/SKILL.md` | One skill per top-level directory. Frontmatter: `name`, `description`, `metadata.author`, `metadata.version`. |
| `hooks/` | Lifecycle hook scripts (circuit breaker, scope guard, stop gate). Hard enforcement, Claude Code only. |
| `harness-everything/scripts/` | Runtime: tier router, todo state machine, verify gate, bootstrap. |
| `evals/<skill>/` | Trigger/routing eval per skill (waza format). Required for every skill — no exceptions. |
| `behavioral-evals/` | LLM-behavior cases run via headless CLI sessions. On-demand only; costs tokens; never CI. |
| `benchmarks/` | BENCHMARK_SOP fixtures and recorded results. Evidence lives here or nowhere. |
| `.claude-plugin/` | Plugin distribution manifests. Must list exactly the on-disk skills. |
| `docs/`, `references/` | Philosophy, architecture, shared checklists. |

## Non-Negotiable Change Rules

1. **Every SKILL.md keeps ≤ 500 tokens** (hard CI gate) and must contain `## USE FOR:` and `## DO NOT USE FOR:` sections. Deep detail goes in the skill's `references/` or `guides/`.
2. **Descriptions are routing surfaces.** Two skills whose descriptions overlap enough that a router cannot distinguish them will fail `test:collision`. When adding a skill, differentiate its description from near neighbors deliberately.
3. **A new skill ships with a routing eval** (`evals/<skill>/eval.yaml` + positive/negative tasks). The positive task's `description:` field must carry the skill's exact frontmatter description — waza's deterministic matcher requires it verbatim.
4. **Version policy:** skill frontmatter versions move in lockstep with releases. Skills modified after a release get bumped to that next version; nothing may exceed the package version's numeric base (`package.json`). Nested sub-skills (`<skill>/<sub>/SKILL.md`) are not routed independently — they inherit the parent skill's version and must always match it. The consistency check enforces both rules.
5. **Manifests are generated facts, not opinions:** if you add/remove/rename a skill directory, update `.claude-plugin/plugin.json` (and marketplace entry version) in the same change. `npm run test:consistency` fails otherwise.
6. **CHANGELOG.md is append-only history.** Every user-visible change gets an entry under the current `-beta` heading before merge.

## Verification Before You Claim Done

Run the full local gate — all of these mirror CI:

```bash
npm test                    # self-regression: syntax, routing tiers, mechanism checks
npm run test:mechanism      # hook-level mechanism suite alone
npm run test:consistency    # manifests, versions, trigger sections, dead links, eval coverage
npm run test:collision      # description collision detection
npm run test:routing:skills # every positive skill route reaches its target
```

If waza is installed (`~/bin/waza`), also run what CI runs:

```bash
waza check <skill-dir>                                  # readiness gates per skill
waza spec verify <skill> evals/<skill>/eval.yaml --fail --threshold 1
waza tokens check                                       # token budgets
```

Do not report "it works" from reading code. Every check above names a command; run it and paste nothing less than its exit code.

## Behavioral & Benchmark Evidence

Mechanism tests prove hooks fire; they cannot prove agents behave differently. For that:

- `node behavioral-evals/run.js run --engine opencode` (or `--engine claude`) — on-demand, token-costing.
- `node benchmarks/run.js scaffold <scenario>` → run both variants → `record` with evidence logs.

Results are committed. A benchmark run without a recorded result is indistinguishable from one that never happened.
