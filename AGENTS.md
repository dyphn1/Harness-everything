---
description: Operating guide for AI agents working inside the Harness-everything repository — layout, change rules, quality gates, and release policy.
---

# AGENTS.md — Working in This Repository

You are modifying **Harness**: an orchestrated agent operating system (skills + hooks/plugins + routing) for AI coding agents. Changes here ship to real agent sessions; a vague `SKILL.md`, stale manifest, or contradictory platform claim can misroute other people's agents. Precision is the product.

## Repository Layout

| Path | What it is |
|---|---|
| `<skill-name>/SKILL.md` | One canonical skill per top-level directory. Frontmatter: `name`, `description`, `metadata.author`, `metadata.version`. |
| `hooks/` | Claude Code lifecycle hook scripts and shared mechanisms such as circuit breaker, scope guard, and stop gate. Do not infer that every host packages every hook. |
| `harness-everything/scripts/` | Runtime: kernel/tier routing, verification, bootstrap, self-heal. |
| `opencode-plugin/` | OpenCode native plugin implementation. Mechanism-tested; live plugin loading remains unverified until real host evidence exists. |
| `.agents/plugins/` + `plugins/harness-everything/` | Local OpenAI/Codex marketplace + `.codex-plugin` package with canonical skill copies and packaged session/prompt hooks. |
| `submission/openai/` | Public OpenAI Skills-only listing/test inputs. The public artifact does not include local `.codex-plugin` lifecycle hooks. |
| `evals/<skill>/` | Trigger/routing eval per skill (waza format). Required for every canonical routed skill. |
| `behavioral-evals/` | LLM-behavior cases run via headless CLI sessions. On-demand only; costs tokens; never CI. |
| `benchmarks/` | BENCHMARK_SOP fixtures and recorded results. Evidence lives here or nowhere. |
| `.claude-plugin/` | Claude Code plugin distribution manifests. Must list exactly the on-disk canonical skills. |
| `docs/platform-capabilities.md` | Canonical current platform/install/enforcement/evidence matrix. |
| `docs/`, `references/` | Philosophy, architecture, workflow documentation, shared checklists. |

## Non-Negotiable Change Rules

1. **Every canonical SKILL.md keeps ≤ 500 tokens** (hard CI gate) and must contain `## USE FOR:` and `## DO NOT USE FOR:` sections. Deep detail goes in the skill's `references/` or `guides/`.
2. **Descriptions are routing surfaces.** Two skills whose descriptions overlap enough that a router cannot distinguish them will fail `test:collision`. When adding a skill, differentiate its description from near neighbors deliberately.
3. **A new canonical skill ships with a routing eval** (`evals/<skill>/eval.yaml` + positive/negative tasks). The positive task's `description:` field must carry the skill's exact frontmatter description — waza's deterministic matcher requires it verbatim.
4. **Version policy:** skill frontmatter versions move in lockstep with releases. Skills modified after a release get bumped to that next version; nothing may exceed the package version's numeric base (`package.json`). Nested sub-skills (`<skill>/<sub>/SKILL.md`) are not routed independently — they inherit the parent skill's version and must always match it. The consistency check enforces both rules.
5. **Distribution manifests are generated facts, not opinions:** if you add/remove/rename a canonical skill, update/sync every distribution that copies or lists it. Run `npm run plugin:sync`, `npm run test:consistency`, and `npm run test:plugin:openai` rather than updating only `.claude-plugin/plugin.json`.
6. **Platform capability claims are tested contracts.** If host integration behavior changes, update `docs/platform-capabilities.md` and every affected current-state surface in the same change. Never turn package/mechanism evidence into a live-host claim, and never describe public Skills-only behavior as if it includes local lifecycle hooks.
7. **CHANGELOG.md is append-only history.** Every user-visible change gets an entry under the current `-beta` heading before merge.

## Verification Before You Claim Done

Run the local gates that mirror CI:

```bash
npm test                       # self-regression: syntax, routing, mechanisms
npm run test:mechanism         # mechanism suites alone
npm run test:consistency       # manifests, versions, docs links, eval coverage + capability docs
npm run test:docs:capabilities # platform documentation drift gate
npm run test:references        # executable/deep-dive references
npm run test:collision         # description collision detection
npm run test:routing:skills    # every positive skill route reaches its target
npm run test:plugin:openai     # local OpenAI/Codex plugin package
npm run test:plugin:submission # public Skills-only submission inputs/bundle parity
```

If waza is installed (`~/bin/waza`), also run what CI runs:

```bash
waza check <skill-dir>
waza spec verify <skill> evals/<skill>/eval.yaml --fail --threshold 1
waza tokens check
```

Do not report "it works" from reading code. Record which evidence layer you actually proved: package, deterministic mechanism, live host, or behavior.

## Behavioral & Benchmark Evidence

Deterministic mechanism tests prove the tested hook/plugin contract; they do **not** prove a real host loaded it or that agents behave differently. For behavior:

- `node behavioral-evals/run.js run --engine opencode` (or `--engine claude`) — on-demand, token-costing.
- `node benchmarks/run.js scaffold <scenario>` → run both variants → `record` with evidence logs.

For a live-host enforcement claim, preserve a host/session artifact showing the mechanism was actually loaded and fired. Results are committed where the relevant evidence workflow requires it. A benchmark run without a recorded result is indistinguishable from one that never happened.
