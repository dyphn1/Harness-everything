---
name: fable-sonnet
description: "Run staged fable work on Sonnet for non-trivial implementation, research synthesis, or bounded reasoning with explicit pass conditions and visible fallback handling."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Fable Mode — Sonnet

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit `fable on sonnet` or the accepted typo `fable on sonnect`. |
| **Expected Output** | A bounded reasoning artifact, audit record, and verifier result. |
| **State Mutations** | Native host TODO tracker or Markdown checklist. |
| **Enforcement Gate** | Named pass condition, actual verification command, and visible unsupported-model handling. |

## USE FOR:
- Non-trivial implementation, analysis, document drafting, and research synthesis
- Bounded stages that need stronger reasoning than bulk processing

## DO NOT USE FOR:
- One obvious single-pass task
- Macro orchestration or final high-stakes decisions (use `fable-opus`)

## Run it

1. Resolve `sonnet` through `../scripts/model-selector.js`; normalize `sonnect` to Sonnet.
2. Spawn `fable-worker-sonnet` when available, otherwise use a visible inline fallback.
3. Brief the exact artifact path, context, and pass condition; workers do not spawn workers.
4. Send high-stakes artifacts to `fable-verifier` and escalate contradictions instead of guessing.

Use `../references/model-matrix.md` for the audit fields and fallback policy.
