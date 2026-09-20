# Harness Philosophy

Harness is built on a simple observation: **strong AI coding models reason well, but can still self-authorize away process obligations when they believe the task is already clear.**

Harness therefore separates reasoning freedom from workflow reliability. It does not prescribe the model's chain of thought or force one giant pipeline. Instead, it establishes the smallest applicable lifecycle contract and lets the model choose how to satisfy it.

The mechanism/enforcement boundary remains platform-specific; see [Platform Capability Matrix](platform-capabilities.md). A semantic contract can be mandatory even when an instruction-only host cannot mechanically block every violation, so contract strength and host enforcement evidence must be reported separately.

## Core Philosophy: Constrain Lifecycle, Not Reasoning

1. **Reasoning autonomy remains high.** The model chooses implementation technique, tools, decomposition details, and tactics inside the selected workflow.
2. **Applicable workflow is guidance: routing should make useful structure visible without taking execution agency away from the model/user.
3. **Skill applicability is explicit.** Router-suggested skills are read/evaluated before omission. A suggestion can be `not-applicable` when its actual flow does not match; a selected topology is stronger and cannot simply be skipped.
4. **Escape is conditional, not default.** If the selected workflow genuinely cannot represent part of the task, record the uncovered scope and evidence, then allow model-defined handling only for that uncovered portion.
5. **Mechanisms beat stronger wording.** Important lifecycle transitions should use structured state, objective evidence, hooks/plugins, exit codes, and completion gates where the host supports them rather than escalating `MUST`/`CRITICAL` prose.

This principle can be summarized as:

> **guidance-first applicable workflow; flexible reasoning/implementation inside it; evidence-backed escape only where the workflow does not cover the task.**

The goal is not to make the model less capable. It is to prevent capability/confidence from silently deleting engineering obligations such as verification, bounded re-planning, stage checks, documentation checks, or safety gates when those obligations are applicable.

## Why This Is Not a Rigid Global Pipeline

Harness still rejects a universal `TODO → TDD → Fable → verification` sequence.

The router chooses the **smallest sufficient topology**:

- `direct-single` for bounded one-pass work;
- `iterative-single` for ordinary bounded reason/act work with objective verification;
- `fable-staged` for dependent multi-stage work;
- `fable-parallel` only for validated independent workstreams;
- `fable-multi-agent-workspace` when persistent roles/handoffs/memory are materially needed.

Domain skills remain conditional on applicability. The contract says “execute the selected lifecycle”, not “execute every skill in the repository.”

## The 4 Pillars of AI Model Guidance

### 1. Environment Alignment — Discovery over Assumption

Discover OS, shell, package/runtime context, repository boundaries, and available host capabilities before relying on them. On surfaces that package preflight/session hooks this can be injected automatically; instruction-only hosts must do it explicitly.

### 2. Guardrails — Lifecycle Boundaries

Circuit breakers, action gates, workflow gates, scope guards, and completion gates protect specific transitions. They should remain narrow and evidence-driven. On integration surfaces that expose the required lifecycle/tool hooks, Harness can mechanically block supported violations; elsewhere the same contract is instruction-governed and must not be mislabeled hard enforcement.

### 3. Context Preservation — Progressive Disclosure

Load the smallest useful context. Read a suggested skill's complete entry before deciding applicability, but do not load the entire skill tree or every optional deep reference. Machine-visible workflow state should carry lifecycle facts instead of repeating large prompt blocks.

### 4. Self-Evolution — Learn from Workflow Evidence

`self-evolve` should learn from verified recovery and workflow gaps: escape events, repeated replans, verifier fail→pass transitions, and recurrence outcomes. It should improve future coverage rather than granting a shortcut around the current workflow. Durable learning remains distinct from runtime session state.

## Mechanism-First Cooperation

Harness prefers a compact control loop:

```text
route -> select workflow -> execute -> verify
                              | fail -> bounded re-plan
                              | uncovered -> evidence-backed escape
                              | pass -> complete
```

This leaves creativity where stronger models benefit from it while making lifecycle obligations observable and testable.

For skill-level coordination, see [Mechanism-First Skill Mesh](mechanism-first-skill-mesh.md). For current installation/enforcement/evidence status, see [Platform Capability Matrix](platform-capabilities.md).
