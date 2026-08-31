---
name: fable-haiku
description: "Run staged fable work on Haiku for bulk mechanical tasks with explicit pass conditions, visible fallback handling, and a cold verifier pass."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Fable Mode — Haiku

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit `fable on haiku` for bulk mechanical or format work. |
| **Expected Output** | A bounded worker artifact, audit record, and verifier result. |
| **State Mutations** | Native host TODO tracker or Markdown checklist. |
| **Enforcement Gate** | Worker pass condition plus `fable-verifier`; unsupported runtime must be visible. |

## USE FOR:
- File processing, format conversion, boilerplate, and structured extraction
- Cheap parallel stages with independently verifiable artifacts

## DO NOT USE FOR:
- Synthesis-heavy or high-stakes architecture decisions
- Delivery without a named pass condition and verifier result

## Run it

1. Resolve `haiku` through `../scripts/model-selector.js`.
2. Spawn `fable-worker-haiku` when available; otherwise use an inline fallback only when the audit record says so.
3. Brief one bounded output path and a named check; workers do not spawn workers.
4. Route synthesis blockers to Sonnet/Opus and cold-review unsupervised delivery with `fable-verifier`.

Use `../references/model-matrix.md` for the audit fields and fallback policy.
