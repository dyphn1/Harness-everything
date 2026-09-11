# Verification & Acceptance Checklist

Run this after installing Harness into a project, or whenever you need to confirm that an integration actually works rather than merely looking correct in the repository.

Harness verification separates four kinds of evidence that must not be conflated:

- **Package / artifact evidence** — are the expected files, manifests, skills, and hooks present?
- **Mechanism evidence** — did the packaged hook/plugin function execute and produce the documented result?
- **Live-host evidence** — did a real host load and fire that mechanism in an actual session?
- **Behavior evidence** — did the agent's conduct follow the intended routing, evidence, and recovery disciplines?

A mechanism test can pass while a live host never loads the plugin. A behavior test can pass on an advisory-only surface without proving any hard enforcement. Keep those claims separate.

The authoritative current platform boundary is [docs/platform-capabilities.md](docs/platform-capabilities.md).

---

## 1. Installation surface check

First identify **which Harness surface you are testing**. One host can have more than one surface; Codex is the main example.

| Surface | Artifact / location | What artifact presence proves |
|---|---|---|
| Claude Code | `.claude/settings.json`, `.claude/skills/`, `.claude/agents/` | The Claude installer/plugin wrote its lifecycle-hook configuration and content |
| OpenCode | `.opencode/plugins/` / `opencode-plugin/index.mjs` | The native plugin module exists; this alone does not prove live loading |
| Codex — general installer | `AGENTS.md`, repo-scoped `.agents/skills/` | Advisory/instruction integration and project Agent Skills are installed |
| **Codex / local OpenAI plugin** | `.agents/plugins/marketplace.json`, `plugins/harness-everything/.codex-plugin/plugin.json`, packaged hooks/skills | The local OpenAI plugin package is structurally present |
| **Public OpenAI Skills-only** | generated `dist/openai-submission/harness-everything-skills.zip` | The public-review bundle was generated; local `.codex-plugin` lifecycle hooks are intentionally not part of this artifact |
| Cursor | `.cursorrules`, `.cursor/skills/` | Advisory project rules and project skills exist |
| Copilot Chat | `.github/copilot-instructions.md`, `.github/skills/` | Advisory repository instructions and project skills exist |
| Continue.dev | `.continue/rules/harness.md`, `.continue/skills/` | Advisory native rule and project skills exist |
| Hermes Agent | `.hermes.md`, trusted project `.agents/skills/` | Advisory project context and discoverable project skills exist; Hermes trust policy still applies |

For user/global skills, verify the host-native path rather than assuming every host consumes the shared Agent Skills directory: Claude uses `~/.claude/skills/`, Continue uses `~/.continue/skills/`, Hermes uses `~/.hermes/skills/`, and the supported shared Agent Skills targets use `~/.agents/skills/`.

### 1a. General installer checks

```bash
# Advisory surfaces
node -e "const fs=require('fs'); for (const p of ['.cursorrules','.github/copilot-instructions.md','AGENTS.md','.continue/rules/harness.md','.hermes.md']) if (fs.existsSync(p)) console.log(p)"

# Project skill roots used by the general installer
node -e "const fs=require('fs'); for (const p of ['.claude/skills','.cursor/skills','.github/skills','.agents/skills','.continue/skills']) if (fs.existsSync(p)) console.log(p)"

# Claude hook configuration
node -e "const fs=require('fs'); const p='.claude/settings.json'; if (fs.existsSync(p)) console.log(Object.keys(JSON.parse(fs.readFileSync(p,'utf8')).hooks||{}))"
```

For an installer target that should be present, FAIL if its expected artifact is missing or does not contain Harness-owned guidance/configuration.

Run the deterministic round-trip gate to verify that installation and removal preserve seeded user-owned files and skills:

```bash
node ci/installer-roundtrip.test.js
```

The CI installer matrix runs this check on Ubuntu, Windows, and macOS.

### 1b. Local OpenAI/Codex plugin package checks

```bash
npm run plugin:sync
npm run test:plugin:openai
```

The package test validates the local marketplace/package layout, all 26 packaged skills, manifest/version alignment, hook definitions, publication-facing metadata, and deterministic routing expectations.

Artifact success proves the package is internally coherent. It does **not** by itself prove a local ChatGPT/Codex host loaded the plugin; use a fresh host session for that claim.

### 1c. Public OpenAI Skills-only package checks

```bash
npm run plugin:submission:build
npm run test:plugin:submission
```

The public Skills-only submission intentionally contains reusable skills and referenced assets but does **not** include the local `.codex-plugin` lifecycle hooks. Do not expect `SessionStart` or `UserPromptSubmit` from this public artifact unless OpenAI introduces a separate validated submission mechanism for them.

---

## 2. Mechanism checks

Mechanism coverage is **surface-specific**. Do not use a Claude hook test to claim another host has the same lifecycle semantics.

### 2a. Repository mechanism suite

```bash
npm run test:mechanism
```

`ci/mechanism-test.js` discovers and runs the repository's focused mechanism suites, including Claude hook behavior and platform/plugin-specific tests that exist in `ci/`.

A passing mechanism suite proves the JavaScript contract under its test harness. It does not automatically prove a real host loaded it.

### 2b. Claude Code lifecycle hooks

Claude Code currently has the broadest verified Harness hook surface: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`-related mechanisms.

When isolating a Claude hook manually on Windows, prefer `child_process.spawnSync` with JSON on stdin rather than a shell `echo '...' | node ...` pipeline; prior audits produced false failures from Git Bash quoting/TTY behavior.

Example — Rule of 3 blocking path:

```bash
node -e "const {spawnSync}=require('child_process'); const r=spawnSync('node',['hooks/scripts/rule-of-3.js'],{input:JSON.stringify({}),encoding:'utf8'}); process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||''); console.log('exit='+r.status)"
```

Use the dedicated `ci/mechanism-2*.test.js` suites as the normative expected-output definitions rather than copying historical shell snippets into new docs.

### 2c. Codex / local OpenAI plugin mechanism

The local OpenAI plugin packages `SessionStart` and `UserPromptSubmit` behavior. Verify its package-level mechanism with:

```bash
npm run test:plugin:openai
npm run test:routing:invariants
```

Then verify a **fresh local host session** separately if you want to claim the host actually loaded and fired those hooks.

Current claim boundary: local session policy and invariant-first routing can be mechanically injected by the packaged plugin. This does not imply Claude Code parity for `PreToolUse`, `PostToolUse`, `Stop`, WAL, or the full circuit-breaker surface.

### 2d. OpenCode plugin mechanism

The repository implements the real OpenCode plugin API and has deterministic mechanism coverage. Run:

```bash
npm run test:mechanism
```

and inspect the OpenCode-specific mechanism suite (`ci/mechanism-2n-opencode-plugin.test.js`).

**Current evidence boundary:** implementation/mechanism-tested, **live plugin loading remains unverified** until a real OpenCode session artifact demonstrates that the host loaded and fired the plugin.

---

## 3. Documentation capability consistency

Platform claims themselves are now a tested contract:

```bash
npm run test:docs:capabilities
npm run test:consistency
```

The capability test checks the current-state documentation surfaces for stale platform paths and pre-plugin claims, requires the Codex local-plugin vs public Skills-only distinction, preserves the OpenCode live-unverified qualifier, and locks the Continue/Hermes native user skill targets.

When changing platform integration behavior, update [docs/platform-capabilities.md](docs/platform-capabilities.md) and all affected current-state docs in the same PR.

---

## 4. Behavioral test prompts

Behavior testing asks whether the agent actually follows the intended discipline. It does not prove mechanism loading unless the session trace also contains mechanism evidence.

See [BENCHMARK_SOP.md](BENCHMARK_SOP.md) for the primary A–E scenarios: over-engineering defense, micro-error loops, macro-task attention, knowledge boundaries, and shell awareness.

### Test F — fact-audit discipline

**Prompt**

> Does the `exit(1)` return code block a PreToolUse hook in Claude Code? Answer directly.

**Expected Harness behavior**

The agent should verify the host behavior from an authoritative source or give the correct grounded answer. A confident incorrect answer is a failure of `verify-before-claim` discipline.

### Test G — evidence and scope boundary

**Prompt**

> Review `src/main.js` and create a feature spec to add user login, then split it into tickets and start coding.

**Expected Harness behavior**

The agent should inspect evidence before asserting design facts, keep implementation scope explicit, and use spec/ticket skills only when their own preconditions are satisfied. The kernel does **not** require a single universal skill chain.

### Test H — bounded multi-agent review

**Prompt**

> Here is my feature spec. Audit it using multi-agent-workspace before we move to tickets.

**Expected Harness behavior**

If the agent chooses multi-agent execution, specialist scopes and merge/verification responsibilities should remain bounded and explicit. Tier 3 does not make multi-agent mandatory when one capable agent can safely complete the work.

---

## 5. Workflow / routing conformance

The current architecture follows one rule:

> **Do not enforce workflow order. Enforce workflow invariants.**

Therefore conformance testing must not require a universal chain such as `TODO → TDD → verification-loop`, nor assert that every TDD task must auto-load a fixed set of companion skills.

For a task run, check these instead:

1. **Route before execution** — software/project work receives a reasonable scope/tier classification before mutation.
2. **Verify before claim** — completion claims are backed by objective evidence appropriate to the change.
3. **Re-plan after repeated same-signature failure** — where the host surface has the mechanism, automatic guards may enforce this; otherwise the recovery discipline remains explicit/advisory.
4. **Skill-local workflow conformance** — when a skill is actually selected, follow that skill's documented local lifecycle (for example RED/GREEN/REFACTOR inside `tdd`).
5. **No false mechanism parity** — do not grade an advisory surface as mechanically broken simply because it lacks a hook that was never packaged there.

Useful routing checks:

```bash
node harness-everything/scripts/kernel-router.js "<Task Prompt>"
npm run test:routing:invariants
npm run test:routing:skills
```

`kernel-router.js` is the public invariant-first entry point. `tier-router.js` remains the underlying classifier/guide-discovery helper. `test:routing:skills` executes the real router for every directly-routable skill and fails if a nested `SKILL.md` appears without an explicit parent/internal classification.

---

## 6. Acceptance scorecard

Fill in one row **per installation surface**, not merely per brand name.

| Check | Claude Code | OpenCode plugin | Codex advisory installer | Codex local OpenAI plugin | Public OpenAI Skills-only | Cursor/Copilot/Continue/Hermes |
|---|---|---|---|---|---|---|
| Package/artifact present | | | | | | |
| Deterministic mechanism tests | | | N/A/explicit CLI only | | N/A (skill bundle) | N/A |
| Live host loaded mechanism | | **unverified until evidenced** | N/A | | N/A | N/A |
| Routing/invariant behavior | | | | | | |
| Objective verification discipline | | | | | | |
| Failure recovery discipline | | | | | | |
| Claim matches documented capability boundary | | | | | | |

Record actual model/tool output for any FAIL or INCONCLUSIVE result. A repair needs to know what happened, not merely that a checkbox failed.

---

## 7. System verification standards

Any repository-wide quality audit should evaluate at least these dimensions and export the result as a separate dated artifact rather than rewriting this standard.

### 7a. Skill description completeness

Check that each `SKILL.md` has precise trigger/use boundaries, expected output, state mutations where applicable, and enough local guidance to execute independently.

### 7b. Routing accuracy

Verify `kernel-router.js` / `tier-router.js` classification and skill suggestions using deterministic routing tests plus live/behavioral evidence where appropriate. Heuristic routing should not be graded as a hard workflow scheduler.

### 7c. Test coverage

Confirm that static syntax, routing, mechanism, reference, package, and behavioral-case structure are each covered by the correct test layer. Do not count a static parser test as live-host evidence.

### 7d. Configuration balance

Evaluate each platform surface according to what it can actually enforce. Avoid both underclaiming a packaged mechanism and overclaiming advisory text as hard enforcement.

### 7e. Workflow conformance

Evaluate the kernel invariants globally and skill-local lifecycles only when those skills are selected. Do not resurrect the retired fixed Tier 2/Tier 3 execution pipelines as acceptance requirements.

---

## 8. Report export guideline

For a comprehensive audit:

1. Create a standalone Markdown report under an appropriate `docs/` report/evidence location used by the current repository.
2. Include the exact revision, platform surface, host/model, commands run, and evidence artifacts.
3. Separate package, mechanism, live-host, and behavior conclusions.
4. Treat dated audit scorecards such as [docs/audit.md](docs/audit.md) as historical snapshots; current platform capability claims come from [docs/platform-capabilities.md](docs/platform-capabilities.md).

## Recommended repository verification set

```bash
npm test
npm run test:consistency
npm run test:references
npm run test:routing:skills
npm run test:routing:invariants
npm run test:plugin:openai
npm run test:plugin:submission
node ci/installer-roundtrip.test.js
```

Do not accept "I read the code and it looks right" as evidence for a runtime or live-host claim.