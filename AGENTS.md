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
| `opencode-plugin/` | OpenCode native plugin implementation. Mechanism-tested, with partial live-host evidence for project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS); see the evidence boundary below. |
| `.agents/plugins/` + `plugins/harness-everything/` | Local OpenAI/Codex marketplace + `.codex-plugin` package with canonical skill copies and packaged session/prompt hooks. |
| `submission/openai/` | Public OpenAI Skills-only listing/test inputs. The public artifact does not include local `.codex-plugin` lifecycle hooks. |
| `evals/<skill>/` | Trigger/routing eval per skill (waza format). Required for every canonical routed skill. |
| `behavioral-evals/` | LLM-behavior cases run via headless CLI sessions. They can be run on demand and are also structurally validated by the weekly `behavioral-evals.yml` workflow; live cases run there only when the Claude CLI is available. |
| `benchmarks/` | BENCHMARK_SOP fixtures and recorded results. Evidence lives here or nowhere. |
| `.claude-plugin/` | Claude Code plugin distribution manifests. Must list exactly the on-disk canonical skills. |
| `docs/platform-capabilities.md` | Canonical current platform/install/enforcement/evidence matrix. |
| `docs/repository-contract.md` | Generated current-state Node/workflow/action/gate contract. Regenerate with `npm run docs:sync`; do not hand-edit. |
| `.nvmrc` | Primary development/CI Node runtime. `package.json#engines.node` remains the minimum supported runtime. |
| `docs/`, `references/` | Philosophy, architecture, workflow documentation, shared checklists. |

## OpenCode evidence boundary

The retained [OpenCode evidence](benchmarks/results/live-host/opencode-2026-09-16/README.md) supports only the scoped loading and state effects above. The final snapshot is post-reset (`hardLock: false`, `count: 1`). Hard lock is only an interactive observation with no retained blocked-tool trace; reflection was operator-seeded, then agent-rewritten. Agent-controlled state deletion resets the breaker, so do not claim durable hard enforcement or behavioral effectiveness. `.mjs` auto-discovery is broken on this host version. Global scope, npm-package installation, and other host versions remain unverified.

## Non-Negotiable Change Rules

1. **Every canonical SKILL.md keeps ≤ 500 tokens** (hard CI gate) and must contain `## USE FOR:` and `## DO NOT USE FOR:` sections. Deep detail goes in the skill's `references/` or `guides/`.
2. **Descriptions are routing surfaces.** Two skills whose descriptions overlap enough that a router cannot distinguish them will fail `test:collision`. When adding a skill, differentiate its description from near neighbors deliberately.
3. **A new canonical skill ships with a routing eval** (`evals/<skill>/eval.yaml` + positive/negative tasks). The positive task's `description:` field must carry the skill's exact frontmatter description — waza's deterministic matcher requires it verbatim.
4. **Release version policy:** normal PRs do not manually bump package/plugin versions. `semantic-release` determines the next stable SemVer from Conventional Commits on `main`, and `scripts/sync-release-version.js` owns distribution-version synchronization. Skill frontmatter versions remain release metadata and must never exceed the package version's numeric base. Nested sub-skills (`<skill>/<sub>/SKILL.md`) inherit the parent skill's version and must always match it.
5. **Distribution manifests are generated facts, not opinions:** if you add/remove/rename a canonical skill, update/sync every distribution that copies or lists it. Run `npm run plugin:sync`, `npm run test:consistency`, and `npm run test:plugin:openai` rather than updating only `.claude-plugin/plugin.json`.
6. **Platform capability claims are tested contracts.** If host integration behavior changes, update `docs/platform-capabilities.md` and every affected current-state surface in the same change. Never turn package/mechanism evidence into a live-host claim, and never describe public Skills-only behavior as if it includes local lifecycle hooks.
7. **Runtime/workflow claims are generated facts.** `package.json`, `.nvmrc`, `Dockerfile`, and active `.github/workflows/*.yml` are parsed by `scripts/repository-contract.js`. After changing them, run `npm run docs:sync`; `test:repo-contract` rejects stale generated docs, unsupported action majors, Node runtimes below the support floor, or loss of the Node 22 compatibility lane.
8. **CHANGELOG.md keeps pending human-authored notes under `[Unreleased]`.** Do not create new alpha/beta/rc release headings; semantic-release owns stable release headings, tags, and release notes.
9. **Conventional Commit type is release input.** The final commit/squash title that lands on `main` must follow the convention. Breaking changes release major; `feat` releases minor; `fix`, `perf`, `refactor`, `build`, and `revert` release patch; `docs`, `test`, `ci`, `style`, and `chore` do not release by themselves.

## Verification Before You Claim Done

Run the local gates that cover the same contract categories as CI:

```bash
npm test                         # self-regression: syntax, routing, mechanisms
npm run test:mutations           # focused mutation checks
npm run test:mechanism           # mechanism suites alone
npm run test:consistency         # manifests, versions, docs links, eval coverage + repository contract
npm run test:repo-contract       # runtime/workflow/action/schedule drift gate
npm run test:docs:capabilities   # platform documentation drift gate
npm run test:references          # executable/deep-dive references
npm run test:release             # release catalog + semantic-release/version-sync contract
npm run test:collision           # description collision detection
npm run test:routing:skills      # every positive skill route reaches its target
npm run test:plugin:openai       # local OpenAI/Codex plugin package
npm run test:plugin:submission   # public Skills-only submission inputs/bundle parity
npm run test:platform:compatibility
```

If waza is installed (`~/bin/waza`), also run what CI runs:

```bash
waza check <skill-dir>
waza spec verify <skill> evals/<skill>/eval.yaml --fail --threshold 1
waza tokens check
```

Node.js 24 is the primary CI runtime across Ubuntu, Windows, and macOS. A separate Ubuntu Node.js 22 lane protects the advertised minimum runtime. See [docs/repository-contract.md](docs/repository-contract.md) for the generated current state.

Do not report "it works" from reading code. Record which evidence layer you actually proved: package, deterministic mechanism, live host, or behavior.

## Behavioral & Benchmark Evidence

Deterministic mechanism tests prove the tested hook/plugin contract; they do **not** prove a real host loaded it or that agents behave differently. For behavior:

- `node behavioral-evals/run.js run --engine opencode` (or `--engine claude`) — on-demand, token-costing.
- The weekly `behavioral-evals.yml` workflow always validates case structure and runs live cases only when its runner has the Claude CLI.
- `node benchmarks/run.js scaffold <scenario>` → run both variants → `record` with evidence logs.

For a live-host enforcement claim, preserve a host/session artifact showing the mechanism was actually loaded and fired. Results are committed where the relevant evidence workflow requires it. A benchmark run without a recorded result is indistinguishable from one that never happened.
