# Skill Registry (Full Activation Map)

## 5. Skill Registry (Full Activation Map)
Every skill in this repository is reachable from this router. If a task matches a trigger below and the skill is not yet loaded, load it.

| Skill | Layer | Activated when |
| :--- | :--- | :--- |
| `install-cognitive-os` | Foundation | Always, before any action (§1). |
| `todo-driven-workflow` | Foundation | Every Tier 2/3 task — the base execution loop (§1). |
| `environment-detection` | Foundation | Session start / `[Discover]` phase, before running shell commands. |
| `fable-mode/execution-guardrails` | Always-on discipline | Every tier: flagging problems, batching warnings, find-and-replace edits (§1). |
| `verify-before-claim` | Always-on discipline | Before asserting external-system behavior or unmeasured numbers (§1). |
| `git-commit` / `rewrite-commits` | Tier 1 | Commit creation / history rewriting. |
| `tdd` | Tier 2 | Feature/bugfix development (Red-Green-Refactor). |
| `using-git-worktrees` | Tier 2 | Isolating feature work on a busy repository. |
| `grill-me` | Tier 2 | User asks to be grilled on a plan (pure Q&A). |
| `improve-codebase-architecture` | Tier 2 | Deep architectural analysis / refactor planning. |
| `eval-harness` | Tier 2 | Scoring, stress testing, benchmark comparison. |
| `verification-loop` | Tier 2/3 gate | Before declaring done or creating a PR. |
| `security-review` | Tier 2/3 gate | Changes touching auth, input handling, secrets, network boundaries. |
| `fable-mode` | Tier 3 | v3 staged planning, named-agent delegation, model selection, failable gates, and cold review. |
| `fable-discipline` | Tier 3 | Risk control paired with fable-mode. |
| `fable-mode/fable-haiku` | Tier 3 (opt-in) | User explicitly asks for staged execution on Haiku for bulk mechanical work. |
| `fable-mode/fable-sonnet` | Tier 3 (opt-in) | User explicitly asks for staged execution on Sonnet for bounded reasoning or synthesis. |
| `fable-mode/fable-opus` | Tier 3 (opt-in) | User explicitly asks for staged execution on Opus for orchestration or high-stakes architecture. |
| `create-agent-launcher` | Tier 3 | Spawning specialized sub-agents. |
| `build-multi-agent-system` | Tier 3 | Scaffolding a multi-agent workspace. |
| `repo-docs` | Tier 3 | Creating project-level documentation. |
| `grill-with-docs` | Tier 3 | Documenting decisions (ADR / CONTEXT) before large designs. |
| `to-spec` | Tier 2/3 (advisory, never a gate) | Synthesizing the (already-settled) conversation into whichever doc shape fits — feature spec, CLI/API reference, schema doc, or dev doc — published to this repo's issue tracker. Explicit-invoke only — never auto-executed. |
| `to-tickets` | Tier 2/3 (advisory, never a gate) | Breaking a `to-spec` feature spec (or an already-settled plan/conversation) into tracer-bullet tickets with declared blocking edges. Reuses `to-spec`'s own `check-project-docs.js` gate — never a second setup interview. Explicit-invoke only — never auto-executed. |
| `zoom-out` | Circuit breaker | Rule of 3 trips (§3). |
| `self-evolve` | Evolution | Post-breaker resolution or major breakthrough (§4). |
| `find-skills` | Meta | No static/generated/already-installed skill covers the user's need (checked live via `npx skills list`, not manifest-cached) — searches skills.sh/`npx skills` and, only with explicit approval, applies it ephemerally via a self-expiring OS-temp cache (`scripts/use-skill.js`, the default — zero persistent footprint) or, only if the user wants to keep it, installs via `npx skills add` (the rare exception). Deliberately not manifest-tracked or router-auto-surfaced like `self-evolve`'s `generated[]` — third-party content isn't lifecycle-owned by Harness the way self-authored skills are. |
| `skill-style` | Meta | Authoring or modifying any SKILL.md in this repository — the terse Skill Contract format spec. |
| `skill-creator` | Meta | Creating a new skill from scratch, auditing/refactoring an existing SKILL.md, or `self-evolve`'s dynamic skill generation step (§4) — the fuller authoring, quality-checklist, and testing workflow built on `skill-style`. |

(`ci/` is internal CI for the router itself — run `node ci/runner.js` after modifying `tier-router.js`; it is not a routable skill. Likewise `scripts/self-heal.js` in this skill is infrastructure, invoked during `[Discover]` per §1.)
