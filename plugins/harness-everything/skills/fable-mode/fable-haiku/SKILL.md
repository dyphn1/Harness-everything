---
name: fable-haiku
description: "Reference mechanical behavior profile (legacy alias haiku) for bulk low-ambiguity work with explicit checks and cold verification; runtime model choice is separate."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.7
---

# Fable Mode — Haiku

> **Reference profile, not a standalone plugin skill.** Invoke this profile through `fable-mode` with `fable on haiku`; plugin manifests do not register this nested directory independently.

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

1. Resolve legacy alias `haiku` to the `mechanical` behavior profile through `<this-skill-dir>/../scripts/model-selector.js`.
2. Spawn `fable-worker-haiku` when available; otherwise use the explicit inline/stop agent fallback. The runtime-model floor is advisory and never changes the profile.
3. Brief one bounded output path and a named check; workers do not spawn workers.
4. Route synthesis blockers to Sonnet/Opus and cold-review unsupervised delivery with `fable-verifier`.

Use `<this-skill-dir>/../references/model-matrix.md` for behavior-profile aliases, runtime floors, audit fields, and fallback policy.
