# Harness Philosophy

Harness is built on a simple observation: **strong AI coding models reason well, but can still self-authorize away process obligations when they believe the task is already clear.**

Harness therefore separates reasoning freedom from workflow reliability. It does not prescribe the model's chain of thought or force one giant pipeline. Instead, it establishes the smallest applicable lifecycle contract and lets the model choose how to satisfy it.

The mechanism/enforcement boundary remains platform-specific; see [Platform Capability Matrix](platform-capabilities.md). A semantic contract can be mandatory even when an instruction-only host cannot mechanically block every violation, so contract strength and host enforcement evidence must be reported separately.

## Core Philosophy: Constrain Lifecycle, Not Reasoning

1. **Reasoning autonomy remains high.** The model chooses implementation technique, tools, decomposition details, and tactics inside the selected workflow.
2. **Selected lifecycle obligations are contracts, not advice.** Once a topology is selected, its required invariants, stages, checks, synthesis barriers, and verification obligations are semantic MUSTs. The model remains free to decide how to satisfy them.
3. **Skill applicability is explicit.** Every router-suggested skill MUST be read/evaluated before omission. If its real flow is applicable, its core contract MUST be followed; if it is not applicable, the agent MUST keep a flow-grounded reason.
4. **Escape is conditional, not default.** If the selected workflow genuinely cannot represent part of the task, record the uncovered scope and evidence, then allow model-defined handling only for that uncovered portion.
5. **Mechanisms do not define obligation strength.** Hooks/plugins may observe, remind, or mechanically block where the host supports them, but a missing blocking mechanism does not downgrade a semantic MUST to optional advice.

This principle can be summarized as:

> **contract-first lifecycle; flexible reasoning/implementation inside it; evidence-backed escape only where the workflow does not cover the task.**

The goal is not to make the model less capable. It is to prevent capability/confidence from silently deleting engineering obligations such as verification, bounded re-planning, stage checks, documentation checks, or safety gates when those obligations are applicable.

## Contract Strength: MUST / SHOULD / MAY

Harness uses three semantic strengths. Recommendation-style language is the last choice, not the default for important behavior.

| Strength | Meaning | Typical use |
|---|---|---|
| **MUST** | Skipping the obligation violates the Harness semantic contract. Host enforcement may still be reminder-only. | routing, applicability resolution, applicable skill core contracts, selected-topology obligations, verification-before-claim, status, scope/safety/authorization evidence |
| **SHOULD** | The default is expected, but a concrete evidence-based exception is legitimate. | ordinary isolation, targeted editing, splitting mixed commit concerns, context-size/noisy-search discipline |
| **MAY** | Optional optimization/capability. Omitting it needs no exception unless another contract selected it. | numeric planning hints, optional ensemble selection, extra deep references, opportunistic parallelism |

Do not use `recommend`, `prefer`, `advisory`, or `guidance` to weaken a MUST. Those words are reserved for actual SHOULD/MAY behavior or for describing the host's **mechanical delivery mode** (for example, an instruction-only surface).

The repository-wide classification for #217 is:

| Obligation | Strength |
|---|---|
| Route before software/project execution | **MUST** |
| Read/evaluate every suggested skill before omission | **MUST** |
| Follow an applicable suggested skill's core contract; otherwise keep a flow-grounded not-applicable reason | **MUST** |
| Resolve selected-topology invariants/stages/checks/synthesis/verification | **MUST** |
| Choose tools, implementation technique, decomposition details, and local tactics | **MAY** within the MUST contract |
| Verify before claiming completion | **MUST** |
| Emit the unified Harness Status for non-trivial work | **MUST** |
| Discover relevant environment/host facts before relying on environment-sensitive behavior | **MUST** |
| Establish current target state before destructive overwrite/rewrite | **MUST** |
| Resolve Tier-3/Fable isolation before broad mutation: linked worktree or explicit degraded fallback | **MUST** |
| Use isolation for ordinary work when it materially reduces collision/risk | **SHOULD** |
| Honor Fable stage contracts, checks, synthesis barrier, and cold verifier when selected | **MUST** |
| Keep delegated agents inside declared scope and reconcile unexpected writes | **MUST** |
| Inspect the staged diff/commit scope before committing | **MUST**; split unrelated concerns **SHOULD** |
| Avoid huge/noisy reads/searches when a narrower query is sufficient | **SHOULD** |
| Numeric iteration/revision/replan/worker values | **MAY** guide planning; never hard-block |
| Select ensemble review | **MAY** when task shape warrants it; once selected, disagreement preservation and independent verification are **MUST** |
| Durable memory writes | **MUST** be authorized by the active workflow/session contract |

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

Relevant environment discovery is a conditional **MUST**: establish OS, shell, package/runtime context, repository boundaries, and host capabilities before relying on environment-sensitive behavior. On surfaces that package preflight/session hooks this may be injected automatically; instruction-only hosts MUST do it explicitly when needed.

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
