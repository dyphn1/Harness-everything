---
name: fable-opus
description: "Run staged fable orchestration on Opus for cross-stage synthesis, high-stakes architecture, and final decisions with named workers, cold verification, and visible fallback handling."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Fable Mode — Opus

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
- Bulk mechanical work (use `fable-haiku`) or bounded reasoning (use `fable-sonnet`)

## Run it

1. Resolve `opus` through `../scripts/model-selector.js`.
2. Spawn `fable-orchestrator` when the runtime exposes it; otherwise report the inline fallback explicitly.
3. The orchestrator owns scope lock, at most two replans, stage contracts, named worker delegation, and escalation; it never produces artifacts itself.
4. Cold-review high-stakes deliverables with `fable-verifier`; report every unverified stage.

Use `../references/model-matrix.md` for the audit fields and fallback policy.
