---
name: fable-mode
description: "Stage large tasks through plans, named fable agents, failable checks, and skeptical review; fable on opus|sonnet|haiku selects a behavior profile, not a runtime model."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.7
---

# Fable Mode

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Profile lookup or Tier 3 execution. |
| **Expected Output** | Profile record or verified stages. |
| **State Mutations** | Execution only: stage checklist and audit records. |
| **Enforcement Gate** | Execution: `<this-skill-dir>/scripts/model-selector.js`, stage contracts, and `<skills-repo-root>/harness-everything/scripts/verify-gate.js`. |

## USE FOR:
- Large multi-file, multi-source, or multi-session work
- Fable profile explanations or explicit Fable execution requests
- Work needing named delegation and cold verification

## DO NOT USE FOR:
- One obvious single-pass edit
- Ordinary Tier 2 implementation or bugfix work

## Select Operation First

For explanation/profile-only lookup, read only `<this-skill-dir>/references/profile-lookup.md` and answer. No stage state, delegation, or selector source reads. Quoted aliases do not start Fable. Mixed execution retains its topology; execution follows the workflow below.

## Workflow

1. Discover the runtime and lock the authorized file scope before edits.
2. Per stage, set artifact, check, and required/optional bindings; dependency-ready stages disclose them, passing once resolved. Gaps never lock tools or Stop; advisory replans never halt. Rule-of-3 covers same-signature failures.
3. Resolve the requested behavior profile with `model-selector.js`; `opus`, `sonnet`/`sonnect`, and `haiku` are compatibility aliases, not model bindings.
4. Delegate by profile: orchestrator coordinates, reasoning takes bounded judgment, mechanical takes low-ambiguity work; workers never spawn workers.
5. The host runtime-model floor is advisory; record it, never block on model choice alone.
6. Run stage checks, cold-review high-stakes artifacts, and audit profile/runtime/fallback fields.

Deep dive: <this-skill-dir>/references/model-matrix.md
