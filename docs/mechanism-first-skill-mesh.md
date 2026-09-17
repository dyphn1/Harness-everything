# Mechanism-First Skill Mesh

Harness is not intended to be a rigid workflow engine. Its skills should remain independently useful, while still coordinating through lightweight mechanisms that help the model and the software engineer work together with less drift, fewer loops, and better evidence.

The preferred shape is a **mechanism-first skill mesh**: skills are autonomous to execute, coordination is explicit, and enforcement happens at narrow decision points through scripts, hooks, exit codes, and compact return values. Router-suggested skills are **mandatory to evaluate before omission, but advisory to execute after evaluation**. Platform-specific enforcement claims follow [platform-capabilities.md](platform-capabilities.md).

---

## Design Intent

Harness exists to improve engineering collaboration, not to replace model judgment with a fixed state machine.

Each skill should be able to answer four questions on its own:

1. **When should I activate?** The trigger should be clear without requiring another skill to interpret it.
2. **What do I protect?** The skill should describe the failure mode it prevents or the engineering habit it reinforces.
3. **What mechanism do I expose?** When possible, the skill should provide a script, command, checklist primitive, verifier, or return-value contract that makes its guidance concrete.
4. **What should I hand to nearby skills?** The skill may recommend a next skill, but it should not require a global handoff template to remain useful.

This keeps the system composable: `tdd` can run alone, `verification-loop` can run alone, `todo-driven-workflow` can run alone, and `harness-everything` can route among them when the task benefits from orchestration. The router may not execute every suggestion, but it may not discard suggestions without first reading/evaluating their actual `SKILL.md` flows.

---

## Why Not a Single Handoff Block?

A universal handoff block makes workflow state easy to parse, but it also has costs:

- It encourages every platform and model to speak in the same rigid shape, even when a natural response would be clearer.
- It can turn skills into a centralized workflow runner instead of a federation of local engineering disciplines.
- It can make the model optimize for satisfying the template rather than making the best next engineering move.
- It adds prompt weight on platforms where the mechanism cannot actually enforce the block.

Harness should avoid mandatory global handoff text. Local skills may still use concise reports when they need them, but the mesh should not depend on one universal response format. The routing checkpoint is a compact state/evaluation surface, not a global handoff protocol.

---

## Mechanisms Over Prose

LLMs are highly sensitive to tool results, command outputs, exit codes, and short structured decisions. Harness should prefer those signals over long textual handoffs.

Good mechanism outputs are:

- **Short:** the result should be easy for the model to keep in active attention.
- **Actionable:** the output should name the next constraint, gate, or recommended skill.
- **Non-authoritarian about execution:** the mechanism may require an evaluation step without forcing a universal workflow sequence.
- **Portable:** hook-capable platforms can run the mechanism automatically; hook-less platforms can call the same script explicitly.

Example shape:

```text
HARNESS_DECISION
tier: 2
required: route-before-execution, verify-before-claim, re-plan-after-repeat-failure, evaluate-suggestions-before-skip
suggest: todo-driven-workflow, verification-loop
suggestion_policy: mandatory-evaluation/advisory-execution
reason: user requested code changes
```

This is not a handoff block. It is a compact mechanical signal. The model remains free to decide how to present the work, explain trade-offs, and collaborate with the engineer after it has evaluated the suggested skill flows.

---

## Skill Autonomy Contract

Every skill in the mesh should remain useful when loaded directly.

Recommended contract:

- **Independent trigger:** the skill description should identify the problem or situation that activates it.
- **Local workflow:** the skill should contain enough guidance to execute without reading the whole Harness ecosystem.
- **Mechanism hook:** if a script can make the skill more reliable, expose it as an optional or required command.
- **Neighbor links:** when another skill is commonly needed, recommend it by name and explain why.
- **Exit discipline:** if the skill reaches a blocking state, it should say what evidence is missing or what human decision is needed.

The local workflow is why read-before-skip can work: the agent can inspect a suggested skill's complete entry and basic flow to judge applicability without loading the whole ecosystem. Optional deep references remain optional unless that entry explicitly makes one necessary to determine applicability.

---

## Coordination Patterns

Harness should coordinate skills through small, composable patterns.

### Router Decision

`harness-everything/scripts/kernel-router.js` is the public invariant-first runtime entry point. It delegates classification and guide discovery to `tier-router.js`, then returns the recommended tier, rationale, required invariants, and skill suggestions. Suggestions use a **mandatory evaluation / advisory execution** contract: before omission, read the complete suggested `SKILL.md` entry and evaluate `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules. It intentionally does not emit a mandatory global execution pipeline.

A name, frontmatter description, router summary, tier label, or “routine task” judgement is not enough to skip a suggestion. Using one suggestion does not waive read-before-skip for the others. If a suggestion cannot be resolved/read, preserve `unresolved/unavailable` rather than silently converting it into “not applicable.”

### Checklist State

`todo-driven-workflow` may own explicit task decomposition state when that helps a Tier 2 or Tier 3 task. It is not a universal prerequisite. When the router suggests it, however, the agent must evaluate its actual skill flow before deciding that native host TODO tracking, a Markdown checklist, or no explicit checklist is the better choice.

### Verification Gate

`verification-loop` and `verify-gate.js` provide reusable verification mechanisms. Hosts with a compatible stop/completion hook can invoke verification mechanically; instruction-only hosts can call the same verifier explicitly before final delivery. If `verification-loop` is router-suggested, read/evaluate its flow before omission even though the kernel already carries a verify-before-claim invariant.

### Recovery Gate

`rule-of-3` and `zoom-out` coordinate through failure signatures and recovery instructions where the host exposes the required lifecycle/tool hooks. On hosts without those hooks, `zoom-out` remains usable as an explicit recovery discipline, but the automatic failure counter must not be implied.

### Skill Suggestion

`self-evolve` and generated skills feed the router through manifest metadata. Once the router surfaces a likely skill, the suggestion becomes an evaluation obligation: inspect its real entry/basic flow before deciding whether it applies. This does **not** make execution mandatory and does not create a fixed pipeline.

---

## Platform Strategy

Harness should use the strongest mechanism each installation surface actually provides.

| Platform class | Preferred coordination style | Enforcement level |
| --- | --- | --- |
| Hook/plugin-capable surfaces | Hooks/plugins run routers, guards, trackers, or completion gates automatically; prompt routing can inject the read-before-skip contract | Mechanical injection/blocking is possible for packaged mechanisms; actual model compliance with skill evaluation still needs live behavioral evidence |
| CLI/tool-capable but hook-less surfaces | The model explicitly calls Harness scripts at decision points and reads/evaluates suggested skills | Mechanism-guided/instruction-governed, not automatically enforced |
| Prompt-only surfaces | Advisory instructions include command snippets and read-before-skip decision rules | Self-regulated by the model |

One host may expose more than one surface. Codex is the important example: the general `--codex` installer path is instruction/advisory oriented, while the **local OpenAI plugin** packages session, prompt, supported-tool, subagent, and stop hooks for mechanism-tested runtime enforcement. The public OpenAI **Skills-only** submission does not include those local lifecycle hooks.

OpenCode is plugin-capable and has partial live-host evidence for project-scope loading/state effects, but the read-before-skip behavioral contract still requires separate retained evidence before being called live-enforced. Claude Code has the broadest currently verified Harness lifecycle-hook surface.

---

## Guidance for Instruction-Only / Hook-Less Paths

Do not recreate hooks with a rigid universal handoff template. Instead, make mechanisms easy to call and make the evaluation requirement explicit.

Implemented today, both wired into `bin/cli.js` and referenced by name in the advisory text each platform's installer writes (`scripts/lib/advisory-text.js`):

- `npx github:dyphn1/Harness-everything next "<prompt>"`: runs the Harness routing path and prints the recommended tier, invariant contract, and matching knowledge/skill suggestions. Every suggested skill must then be read/evaluated before omission.
- `npx github:dyphn1/Harness-everything verify`: wraps `verify-gate.js`, running the target project's own lint/test scripts and exiting non-zero on failure. This is the explicit hook-less verification path; it is not equivalent to claiming that a host automatically runs a `Stop` hook.

Both resolve their target scripts relative to the CLI's own package install, not the caller's cwd, so they work the same way regardless of which platform-specific directory (`.codex/skills/`, `.cursor/skills/`, `.github/skills/`, ...) a copy of the `harness-everything` skill also happens to be sitting in — a fixed relative path like `harness-everything/scripts/tier-router.js` would silently point at nothing depending on which platform installed it.

Not yet implemented — still aspirational, do not reference these as if they exist until they're built:

- `harness recover`: summarize repeated failure signatures and recommend `zoom-out` when needed. Hook-less paths do not collect failure signatures the way the Claude Code `PostToolUse` mechanism does, so there is no reliable state to summarize yet.
- `harness skills`: list installed, generated, and matching skills for the current workspace.

These commands let instruction-only Codex installs, Cursor, Copilot, Continue, and Hermes receive high-signal mechanical feedback without forcing them into a single scripted conversation shape.

---

## Anti-Goals

Harness should not become:

- A centralized DAG runner where every skill depends on one global workflow file.
- A mandatory response-template system that suppresses useful model variation.
- A command-only framework where skills cannot be understood by reading `SKILL.md`.
- A hidden daemon that performs broad actions without visible evidence.
- A platform-specific product that only works well when Claude Code hooks are available.
- A recommendation system whose suggestions are routinely ignored without inspecting the workflows they represent.

The mesh should remain local, legible, and cooperative.

---

## Practical Authoring Rules

When adding or revising a skill:

1. Keep the skill independently executable.
2. Put enough applicability and basic-flow information in `SKILL.md` for read-before-skip evaluation; do not hide the decision-critical contract only in optional deep references.
3. Add a script only when a mechanism can make the behavior more reliable than prose.
4. Keep script output compact and stable enough for models to react to.
5. Prefer gates at natural decision points: before editing, after repeated failure, before final delivery, and before persistence.
6. Let the model choose wording and presentation unless the skill truly needs a specific artifact format.
7. Document neighboring skills as recommendations, not hidden execution dependencies, unless the dependency is required for safety. Router-surfaced recommendations still inherit mandatory evaluation before omission.

The result should feel like an engineering co-pilot with good reflexes: autonomous where creativity matters, constrained where repeated mistakes are expensive, and explicit whenever evidence or applicability evaluation is needed.
