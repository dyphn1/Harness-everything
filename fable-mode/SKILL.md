---
name: fable-mode
description: "Stage large tasks through plans, named fable agents, failable checks, and skeptical review; fable on opus|sonnet|haiku selects a behavior profile, not a runtime model."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.2
---

# Fable Mode (v3)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 3 work spanning multiple files, sources, or sessions. |
| **Expected Output** | Stage map, named-agent briefs, failable checks, and skeptical review. |
| **State Mutations** | Native host TODO tracker or a Markdown checklist; one JSON audit record per stage. |
| **Enforcement Gate** | `<this-skill-dir>/scripts/model-selector.js`, stage contracts, and `<skills-repo-root>/harness-everything/scripts/verify-gate.js`. |

## USE FOR:
- Large multi-file, multi-source, or multi-session work
- Explicit `fable on haiku`, `fable on sonnet`, or `fable on opus` requests
- Work needing named delegation and cold verification

## DO NOT USE FOR:
- One obvious single-pass edit
- Ordinary Tier 2 implementation or bugfix work

## Workflow

1. Discover the runtime and lock the authorized file scope before edits.
2. Write a numbered stage map with one artifact and pass condition per stage; allow at most two full replans.
3. Resolve the requested behavior profile with `model-selector.js`; `opus`, `sonnet`/`sonnect`, and `haiku` are compatibility aliases, not model bindings.
4. Delegate by profile: orchestrator coordinates, reasoning handles bounded judgment, mechanical handles low-ambiguity work, and workers never spawn workers.
5. Treat the host runtime-model floor as advisory; record its status without blocking Fable solely for model choice.
6. Run each stage check, cold-review high-stakes artifacts, and keep profile/runtime/fallback fields auditable.

Deep dive: <this-skill-dir>/references/model-matrix.md
