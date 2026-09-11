# Harness Reflection, Memory & Self-Evolution

AI models can forget lessons learned in previous coding sessions. When a bug is solved, a later session may encounter the same environment quirk or framework gotcha and repeat the same mistake.

Harness addresses this with two deliberately separate concepts:

1. **Runtime session state** — checkpoints/WAL-style state on integration surfaces that actually package the corresponding lifecycle/tool hooks.
2. **Durable workspace learning** — `self-evolve` can persist a verified lesson as a concise rule or reusable generated skill when that persistence is justified.

Do not infer runtime-state parity from shared skill text. The current platform boundary is documented in [platform-capabilities.md](platform-capabilities.md).

---

## Runtime Transaction State & Session Handoff

The Claude Code hook path uses `hooks/scripts/state-persist.js` and `bootstrap.js` to maintain bounded runtime state and recover useful context across supported sessions.

On a surface that packages those mechanisms:

* **Outcome capture:** supported tool outcomes/milestones can update the session transaction state.
* **Handoff checkpoint:** a session checkpoint can record pending/failed state for later recovery.
* **Session-start recovery:** a compatible session-start hook can surface that checkpoint back to the agent.

This is a runtime integration feature, not a property of every Harness skill installation. The **Codex / local OpenAI plugin** currently packages its own `SessionStart` and `UserPromptSubmit` invariant hooks, but that does not imply the full Claude `state-persist.js` / WAL / `PostToolUse` surface is present. The public OpenAI **Skills-only** artifact has no local `.codex-plugin` lifecycle hooks at all.

---

## Long-term Memory & Workspace Rules

When a complex issue — such as an environment-specific bug, unique framework quirk, or custom build requirement — is successfully resolved, the agent may use `self-evolve` to decide whether the verified lesson deserves durable persistence:

1. **Deep Reflection:** establish the actual root cause and supporting evidence rather than persisting a guess.
2. **Rule Generation:** abstract the lesson into a concise rule when a simple local reminder is enough.
3. **Memory vs. Dynamic Skill Judgment:** decide whether the insight is a simple localized tip or a reusable multi-step procedure. Packaging every lesson as a skill would create unnecessary context and maintenance cost.
   * **Simple Rule (default path):** persist to authorized local workspace rules via `persist-memory.js`.
   * **Dynamic Skill (exception path):** create a standalone `SKILL.md` that satisfies `skill-creator`'s Dynamic Skill Generation Contract and register it through the supported manifest workflow so routing can surface it later.
4. **Validation Before Persistence:** persistence is allowed only after the relevant validation/self-regression checks establish that the artifact is structurally valid and does not break the repository contract.

`self-evolve` is not assumed to auto-trigger on every completed task. It is a reusable persistence workflow the agent selects when a lesson is both verified and worth keeping.

---

## External Skills: A Deliberately Different Loop for Third-Party Content

`self-evolve`-generated skills are workspace-authored content whose lifecycle Harness can validate and manage. `find-skills` solves a different problem: discovering third-party skills that may change independently of this repository.

Treating those two sources as the same trust tier would create silent drift. A fetched external skill can change upstream, be updated/removed outside Harness, or have metadata that no longer matches a cached copy.

For that reason, `find-skills` prefers live/ephemeral discovery rather than silently converting borrowed content into durable Harness memory. `find-skills/scripts/use-skill.js` wraps the external fetch/apply path behind a content-addressed temporary cache, avoiding repository or manifest pollution for one-off use. Permanent installation remains an explicit user choice rather than the default persistence path.

This separation keeps two questions distinct:

- **What did this workspace learn and intentionally persist?** → `self-evolve` / generated rules or skills.
- **What external expertise can this task borrow right now?** → `find-skills` / third-party discovery.

---

## The Benefits of Self-Evolution

* **Immunization:** verified recurring lessons can become durable workspace guidance.
* **Team Alignment:** project-owned rules/skills can be reviewed and shared through the repository's normal change process.
* **Token Efficiency:** durable, concise knowledge can reduce repeated rediscovery without pretending every session has universal background memory.
* **Clear evidence boundary:** session runtime state, durable project knowledge, and third-party borrowed skills remain separate mechanisms with separate trust and lifecycle rules.
