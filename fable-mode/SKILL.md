---
name: fable-mode
description: "Stage large, multi-source or multi-session tasks through a written plan, named fable agents, failable per-stage checks, and skeptical delivery review; use fable-opus, fable-sonnet, or fable-haiku for explicit model selection."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
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
3. Resolve the requested model with `<this-skill-dir>/scripts/model-selector.js`; never silently downgrade.
4. Delegate by named agent where available: Opus orchestrates, Sonnet reasons, Haiku handles mechanical work, and workers never spawn workers.
5. Write a stage contract, run its named check, then cold-review high-stakes artifacts with `fable-verifier`.
6. Record requested/effective model, fallback reason, stage brief, pass condition, verification command, and verifier result for every stage. Escalate unresolved blockers.

Model roles, fallback behavior, and the audit schema live in `<this-skill-dir>/references/model-matrix.md`.
