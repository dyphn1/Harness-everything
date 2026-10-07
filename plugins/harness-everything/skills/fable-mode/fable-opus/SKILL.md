---
name: fable-opus
description: "Reference orchestrator behavior profile (legacy alias opus) for staged synthesis, architecture, named delegation, and cold verification; runtime model choice is separate."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.6
---

# Fable Mode — Opus

> **Reference profile, not a standalone plugin skill.** Invoke this profile through `fable-mode` with `fable on opus`; plugin manifests do not register this nested directory independently.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit `fable on opus` for macro orchestration or high-stakes decisions. |
| **Expected Output** | A staged orchestration record, worker artifacts, and cold-verifier results. |
| **State Mutations** | Native host TODO tracker or Markdown checklist; stage contracts remain auditable. |
| **Enforcement Gate** | `fable-orchestrator`, named worker checks, `fable-verifier`, and visible blocker/escalation status. |

## USE FOR:
- Cross-stage synthesis, architecture decisions, and final macro-task review
- Tasks that need the Write-less orchestrator to delegate artifact production

## DO NOT USE FOR:
- One obvious single-pass task
- Bulk mechanical work (select `fable on haiku`) or bounded reasoning (select `fable on sonnet`)

## Run it

1. Resolve legacy alias `opus` to the `orchestrator` behavior profile through `<this-skill-dir>/../scripts/model-selector.js`.
2. Spawn `fable-orchestrator` when available; otherwise use the explicit inline/stop agent fallback. The runtime-model floor is advisory and never changes the profile.
3. The orchestrator owns scope boundaries, advisory replan guidance (never a hard stop), stage contracts, named worker delegation, and escalation; it never produces artifacts itself. After three same-signature failures, Rule-of-3 / `zoom-out` is mandatory.
4. Cold-review high-stakes deliverables with `fable-verifier`; report every unverified stage.

Use `<this-skill-dir>/../references/model-matrix.md` for behavior-profile aliases, runtime floors, audit fields, and fallback policy.
