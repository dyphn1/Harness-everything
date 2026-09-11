# Harness Philosophy

Harness is built on a single, core belief: **AI coding models are highly capable, but they struggle with self-regulation, attention drift, and environment awareness.**

Instead of replacing the model or restricting it with heavy, opinionated frameworks that stifle creativity, Harness acts as a **behavioral layer** — reusable skills plus the strongest lightweight runtime mechanisms each supported installation surface actually provides.

The current mechanism/enforcement boundary is platform-specific; see [Platform Capability Matrix](platform-capabilities.md). A skill-only or instruction-only install must not be described as if it automatically runs lifecycle hooks.

---

## The Core Philosophy: Intervene Only When Necessary

Many AI development frameworks attempt to fully control the model's execution flow. They use rigid DAGs, forced chains, or complex state machines. While this works for trivial, repetitive tasks, it can suppress useful model judgment on complex, novel engineering work.

Harness takes the opposite approach:

1. **Model Autonomy is Paramount:** The model should have freedom to explore, choose useful skills/tools, and design its solution inside a small set of cross-cutting invariants.
2. **Context-Driven Guidance:** Harness uses high-context, low-friction signals — skills, rules, local checks, and hooks/plugins where the host supports and packages them — rather than one rigid global execution path.
3. **Reactive Guardrails:** On integration surfaces that expose the required lifecycle/tool hooks, Harness can stay quiet until a boundary is violated or a repeated failure is detected. On advisory surfaces, the same principles remain guidance rather than automatic blocking.
4. **Behavior-First, Not Prompt-First:** Harness is not a collection of magic prompts. Its skills remain independently useful, while supported runtime adapters can react to real tool/session outcomes and workspace conditions.

---

## The 4 Pillars of AI Model Guidance

To keep agents aligned and productive, Harness operates across four distinct domains. The **principle** applies everywhere; whether it is injected or enforced automatically depends on the selected host surface.

### 1. Environment Alignment (Discovery over Assumption)

AI models often hallucinate terminal environments or make incorrect assumptions about the host operating system, shell, or package manager — especially on Windows or mixed-shell setups.

Harness requires environment assumptions to be discovered rather than guessed. On surfaces that package a session-start/preflight hook, that context can be injected automatically. On instruction/skill-only paths, the agent must discover it explicitly before relying on shell-specific commands.

### 2. Guardrails (The Circuit Breakers)

When a model gets stuck on a subtle bug or compiler error, its natural tendency is to make micro-adjustments repeatedly.

The Harness recovery invariant is to stop same-signature micro-retries and re-plan after repeated failure. On hosts where the Rule-of-3 mechanism is actually packaged, a circuit breaker can track failures and block further mutation until a `zoom-out` diagnosis is performed. On other surfaces, `zoom-out` remains a reusable recovery discipline but there is no claim that an automatic counter/blocker exists.

### 3. Context Preservation (Anti-Bloat Protection)

As sessions grow, models can read too broadly or produce oversized output, degrading active context.

Harness uses narrow reads, explicit scope, compact evidence, and — where a compatible runtime adapter exists — boundary mechanisms that can react mechanically. Skill-only surfaces still receive the discipline, but not an imaginary background daemon or hook.

### 4. Self-Evolution (Continuous Workspace Memory)

When a complex issue is resolved, Harness can turn the verified lesson into durable workspace knowledge through `self-evolve`: a concise rule or a reusable generated skill, when persistence is actually justified.

This long-term learning path is distinct from **runtime session state** such as WAL/checkpoint files. Runtime state exists only on integrations that package the corresponding state hooks; reusable rules/skills are project artifacts and can outlive a single host session.

---

## A Non-Intrusive Cognitive Amplifier

Harness does not require a heavy daemon or a proprietary service. The repository's mechanisms and skill content operate locally in the developer/host environment, while each platform gets only the enforcement strength its real integration supports.

For skill-level coordination, see [Mechanism-First Skill Mesh](mechanism-first-skill-mesh.md). For the exact current platform/install/evidence boundary, see [Platform Capability Matrix](platform-capabilities.md).
