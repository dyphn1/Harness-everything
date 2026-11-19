---
name: fable-mode
description: "Stage large tasks through plans, named fable agents, failable checks, and skeptical review; fable on opus|sonnet|haiku selects a behavior profile, not a runtime model."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.31.3
---

# Fable Mode

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Profile lookup or Tier 3 execution. |
| **Expected Output** | Profile record or verified stages. |
| **State Mutations** | Execution: stage checklist and audit. |
| **Enforcement Gate** | `<this-skill-dir>/scripts/model-selector.js`, stage contracts, and `<skills-repo-root>/harness-everything/scripts/verify-gate.js`. |

## USE FOR:
- Large multi-file, multi-source, or multi-session work
- Fable profile explanations or explicit Fable execution requests
- Work needing named delegation and cold verification

## DO NOT USE FOR:
- One obvious single-pass edit
- Ordinary Tier 2 implementation or bugfix work

## Select Operation First

For explanation or profile lookup, read only `<this-skill-dir>/references/profile-lookup.md`. Quoted aliases do not start Fable. Mixed requests retain topology.

## Workflow

1. Discover runtime and lock authorized file scope before edits.
2. Define stage artifacts, checks, and bindings. Disclose bindings when dependencies pass. Resolve required bindings before passing. Gaps never lock tools or Stop. Advisory replans never halt. Rule-of-3 covers same-signature failures.
3. Resolve the behavior profile with `model-selector.js`. `opus`, `sonnet`/`sonnect`, and `haiku` are profile aliases.
4. Delegate by profile. Workers never delegate. Before each Codex subagent dispatch, the coordinator MUST capture the worker baseline per “Verification and handoff” in `<this-skill-dir>/references/execution-phases.md`.
5. Record the advisory runtime-model floor.
6. At each Codex subagent handoff, the coordinator MUST reconcile scope before passing the stage or using its result downstream, including silent stops. Run stage checks, cold-review high-stakes artifacts, and audit profile/runtime/fallback.

Deep dive: <this-skill-dir>/references/model-matrix.md
