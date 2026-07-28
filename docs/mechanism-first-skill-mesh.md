# Mechanism-First Skill Mesh

Harness is not intended to be a rigid workflow engine. Its skills should remain independently useful, while still coordinating through lightweight mechanisms that help the model and the software engineer work together with less drift, fewer loops, and better evidence.

The preferred shape is a **mechanism-first skill mesh**: skills are autonomous, coordination is explicit, and enforcement happens at narrow decision points through scripts, hooks, exit codes, and compact return values.

---

## Design Intent

Harness exists to improve engineering collaboration, not to replace model judgment with a fixed state machine.

Each skill should be able to answer four questions on its own:

1. **When should I activate?** The trigger should be clear without requiring another skill to interpret it.
2. **What do I protect?** The skill should describe the failure mode it prevents or the engineering habit it reinforces.
3. **What mechanism do I expose?** When possible, the skill should provide a script, command, checklist primitive, verifier, or return-value contract that makes its guidance concrete.
4. **What should I hand to nearby skills?** The skill may recommend a next skill, but it should not require a global handoff template to remain useful.

This keeps the system composable: `tdd` can run alone, `verification-loop` can run alone, `todo-driven-workflow` can run alone, and `harness-everything` can route among them when the task benefits from orchestration.

---

## Why Not a Single Handoff Block?

A universal handoff block makes workflow state easy to parse, but it also has costs:

- It encourages every platform and model to speak in the same rigid shape, even when a natural response would be clearer.
- It can turn skills into a centralized workflow runner instead of a federation of local engineering disciplines.
- It can make the model optimize for satisfying the template rather than making the best next engineering move.
- It adds prompt weight on platforms where the mechanism cannot actually enforce the block.

Harness should avoid mandatory global handoff text. Local skills may still use concise reports when they need them, but the mesh should not depend on one universal response format.

---

## Mechanisms Over Prose

LLMs are highly sensitive to tool results, command outputs, exit codes, and short structured decisions. Harness should prefer those signals over long textual handoffs.

Good mechanism outputs are:

- **Short:** the result should be easy for the model to keep in active attention.
- **Actionable:** the output should name the next constraint, gate, or recommended skill.
- **Non-authoritarian:** the mechanism should guide the model without stealing all judgment from it.
- **Portable:** hook-capable platforms can run the mechanism automatically; hook-less platforms can call the same script explicitly.

Example shape:

```text
HARNESS_DECISION
tier: 2
load: todo-driven-workflow, verification-loop
gate: verify-before-final
reason: user requested code changes
```

This is not a handoff block. It is a compact mechanical signal. The model remains free to decide how to present the work, explain trade-offs, and collaborate with the engineer.

---

## Skill Autonomy Contract

Every skill in the mesh should remain useful when loaded directly.

Recommended contract:

- **Independent trigger:** the skill description should identify the problem or situation that activates it.
- **Local workflow:** the skill should contain enough guidance to execute without reading the whole Harness ecosystem.
- **Mechanism hook:** if a script can make the skill more reliable, expose it as an optional or required command.
- **Neighbor links:** when another skill is commonly needed, recommend it by name and explain why.
- **Exit discipline:** if the skill reaches a blocking state, it should say what evidence is missing or what human decision is needed.

This contract keeps skills interoperable without requiring central ownership of every task path.

---

## Coordination Patterns

Harness should coordinate skills through small, composable patterns.

### Router Decision

`harness-everything/scripts/tier-router.js` is the model-facing triage mechanism. It should return the smallest useful routing decision: tier, rationale, suggested skills, and any gate that should apply before editing or final delivery.

### Checklist State

`todo-driven-workflow` should own task decomposition state when a task is Tier 2 or Tier 3. The state should be machine-readable when possible, but the model should not be forced into a single response format.

### Verification Gate

`verification-loop` and `verify-gate.js` should provide the delivery check. Hook-capable platforms can run it automatically before stop; hook-less platforms can run it as an explicit pre-final command.

### Recovery Gate

`rule-of-3` and `zoom-out` should coordinate through failure signatures and recovery instructions. The key handoff is the observed failure signature, not a prose summary.

### Skill Suggestion

`self-evolve` and generated skills should feed the router through manifest metadata. The router should surface likely skills, but the model keeps final responsibility for selecting what actually applies.

---

## Platform Strategy

Harness should use the strongest mechanism each platform provides.

| Platform class | Preferred coordination style | Enforcement level |
| --- | --- | --- |
| Hook-capable platforms | Hooks run routers, guards, trackers, and stop gates automatically | Mechanical blocking is possible |
| CLI/tool-capable but hook-less platforms | The model explicitly calls Harness scripts at decision points | Mechanism-guided, not automatically enforced |
| Prompt-only platforms | Advisory instructions include command snippets and decision rules | Self-regulated by the model |

The same skills should work across all three classes. The difference is whether the mechanism is invoked automatically, explicitly, or only described.

---

## Guidance for Hook-Less Platforms

Do not recreate hooks with a rigid universal handoff template. Instead, make mechanisms easy to call.

Implemented today, both wired into `bin/cli.js` and referenced by name in the advisory text each platform's installer writes (`scripts/lib/advisory-text.js`):

- `npx github:dyphn1/Harness-everything next "<prompt>"`: wraps `tier-router.js`, printing the recommended tier, base execution loop, and matching knowledge guides for a prompt.
- `npx github:dyphn1/Harness-everything verify`: wraps `verify-gate.js`, running the target project's own lint/test scripts and exiting non-zero on failure. This is the explicit, hookless stand-in for Claude Code's `stop-gate.js`.

Both resolve their target scripts relative to the CLI's own package install, not the caller's cwd, so they work the same way regardless of which platform-specific directory (`.codex/skills/`, `.cursor/skills/`, `.github/skills/`, ...) a copy of the `harness-everything` skill also happens to be sitting in - a fixed relative path like `harness-everything/scripts/tier-router.js` would silently point at nothing depending on which platform installed it.

Not yet implemented - still aspirational, do not reference these as if they exist until they're built:

- `harness recover`: summarize repeated failure signatures and recommend `zoom-out` when needed. Blocked on hookless platforms not having anything that collects failure signatures the way `rule-of-3.js`'s `PostToolUse` hook does on Claude Code - the state to summarize doesn't exist yet.
- `harness skills`: list installed, generated, and matching skills for the current workspace.

These commands let Codex, Cursor, Copilot, Continue, and Hermes receive high-signal mechanical feedback without forcing them into a single scripted conversation shape.

---

## Anti-Goals

Harness should not become:

- A centralized DAG runner where every skill depends on one global workflow file.
- A mandatory response-template system that suppresses useful model variation.
- A command-only framework where skills cannot be understood by reading `SKILL.md`.
- A hidden daemon that performs broad actions without visible evidence.
- A platform-specific product that only works well when Claude Code hooks are available.

The mesh should remain local, legible, and cooperative.

---

## Practical Authoring Rules

When adding or revising a skill:

1. Keep the skill independently executable.
2. Add a script only when a mechanism can make the behavior more reliable than prose.
3. Keep script output compact and stable enough for models to react to.
4. Prefer gates at natural decision points: before editing, after repeated failure, before final delivery, and before persistence.
5. Let the model choose wording and presentation unless the skill truly needs a specific artifact format.
6. Document neighboring skills as recommendations, not hidden dependencies, unless the dependency is required for safety.

The result should feel like an engineering co-pilot with good reflexes: autonomous where creativity matters, constrained where repeated mistakes are expensive, and explicit whenever evidence is needed.
