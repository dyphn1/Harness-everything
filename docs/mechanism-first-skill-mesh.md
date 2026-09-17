# Mechanism-First Skill Mesh

Harness coordinates independently useful skills through a small workflow runtime. It does **not** make every skill part of one universal DAG, but it also does not leave selected execution topology to model discretion.

The preferred shape is:

> **mandatory applicable workflow + local skill autonomy + narrow runtime mechanisms**

Platform-specific enforcement claims remain bounded by [platform-capabilities.md](platform-capabilities.md).

## Design Intent

Each skill remains understandable/executable on its own, while the kernel provides an outer lifecycle contract.

A skill should answer:

1. **When should I activate?** Clear `USE FOR` / `DO NOT USE FOR` applicability.
2. **What do I protect?** The failure mode or engineering discipline it addresses.
3. **What workflow/mechanism do I expose?** A local flow, verifier, script, gate, or stable result when useful.
4. **What evidence means I am done?** A check, artifact, or explicit blocked state.

The router may surface several skills. Those suggestions must be evaluated from their actual `SKILL.md` flows before omission. They are **not** automatically all executed. Separately, the router selects one smallest sufficient outer topology; once selected, that topology is mandatory for the run.

## Why Not One Global Skill Sequence?

A universal TODO/TDD/Fable sequence would:

- add prompt/runtime overhead to small tasks;
- confuse domain skills with orchestration topology;
- suppress useful model judgment inside stages;
- fail poorly on hosts that cannot enforce the same lifecycle APIs.

So Harness separates **topology** from **capabilities/domain skills**:

```text
tier / task shape
      +
selected execution topology
      +
applicable skills/capabilities
      +
required invariants/gates
```

The topology is the lifecycle contract. Skills are resolved for applicability within/around that contract.

## Mechanisms Over Prose

Prefer short structured state, tool results, exit codes, and objective evidence over stronger prompt wording.

Example:

```text
HARNESS_DECISION
tier: 2
strategy: iterative-single
workflow_state: active
required: route-before-execution, objective-verification, loop-budget
suggest: tdd, verification-loop
suggestion_policy: evaluate-applicability
escape_policy: workflow-uncovered-scope-only
```

This says what must happen without prescribing private reasoning or exact implementation tactics.

Good mechanisms are:

- **short** enough to remain salient;
- **actionable** with an explicit next state;
- **failable** when a requirement is unmet;
- **bounded** by host capability/evidence;
- **non-prescriptive about HOW** unless a safety/contract requirement needs it.

## Skill Autonomy Contract

Every skill should retain:

- an independent trigger;
- a local workflow;
- objective/failable checks where possible;
- explicit neighbor links rather than hidden dependencies;
- blocked/exit discipline.

Read-before-omission exists so the agent can inspect this local contract without loading the entire ecosystem. If the skill flow applies, follow it; reading a skill is not permission to discard an applicable discipline because the model believes it already knows the answer.

## Coordination Patterns

### Router Decision

`harness-everything/scripts/kernel-router.js` emits tier, strategy, invariants, skill suggestions, and an execution contract.

- Suggested skills: read and resolve applicability (`use`, `not-applicable`, `unresolved/unavailable`).
- Selected topology: execute to resolution (`active` → verified/satisfied, blocked, or explicit evidence-backed escape).

Names/descriptions/router summaries or “routine task” judgements cannot resolve applicability by themselves.

### Fable Stage Contracts

For `fable-*` strategies, Fable owns stage lifecycle: `dependsOn`, `writeSet`, validated batches, objective checks, synthesis, cold verification, and bounded re-planning. The parent cannot replace a selected Fable topology with direct editing on hook-capable paths that package the workflow gate.

### Verification Gate

`verification-loop`, `verify-gate.js`, ordinary stop-gates, and Fable stage evidence provide objective completion signals. Verification is not an optional courtesy when selected/applicable workflow state requires it.

### Recovery Gate

Rule-of-3 stops repeated same-signature micro-retries and requires a new diagnosis. Fable verification failures return to bounded re-planning; budget exhaustion becomes blocked instead of endless iteration.

### Action Gate

Irreversible/external side effects are orthogonal to topology and require their pre-action gate where supported. Workflow escape never widens permissions or bypasses action approval.

### Self-Evolve

Learning should consume verified lifecycle evidence (escape, re-plan, recovery, recurrence), not operate as a side door around the active workflow.

## Platform Strategy

| Platform class | Workflow contract | Mechanical enforcement |
| --- | --- | --- |
| Hook/plugin-capable | Same selected-workflow contract | Supported transitions can be blocked/observed by packaged mechanisms |
| CLI/tool-capable without lifecycle hooks | Same contract stated/called explicitly | Instruction/mechanism guided; no automatic blocking claim |
| Prompt-only | Same semantic obligations | Self-regulated only |

Contract semantics and enforcement evidence are separate. Claude currently packages the broadest Harness lifecycle surface. The local OpenAI/Codex plugin packages supported adapters but requires live-host evidence before parity claims. The public OpenAI Skills-only artifact carries skill/workflow knowledge without local lifecycle hooks. OpenCode has its own plugin path and evidence boundaries.

## Hook-Less Paths

Two explicit commands provide high-signal state without pretending hooks exist:

```bash
npx github:dyphn1/Harness-everything next "<prompt>"
npx github:dyphn1/Harness-everything verify
```

`next` emits the routing/workflow contract. `verify` runs the explicit verification path. Instruction-only hosts must treat these requirements as real even though the host cannot mechanically prevent skipping them.

## Anti-Goals

Harness should not become:

- one global DAG containing every skill;
- a mandatory response-template system;
- a command-only framework whose skills are unreadable without runtime code;
- a hidden daemon with broad authority;
- a system that claims cross-host hard enforcement from package text;
- a recommendation system where selected workflows can be rationalized away.

## Practical Authoring Rules

1. Keep skills independently understandable/executable.
2. Put applicability/basic flow in `SKILL.md`; deep detail belongs in references.
3. Add mechanisms when they make behavior more reliable than prose.
4. Make checks failable and evidence-based.
5. Put gates at real transition boundaries: before mutation/side effects, after repeated failure, before completion, before persistence.
6. Let the model choose HOW inside the contract.
7. Treat workflow escape as a measured coverage gap, not convenience.

The result should feel like a capable engineer operating inside explicit lifecycle obligations rather than either a scripted automaton or an unconstrained model that can skip its own process.
