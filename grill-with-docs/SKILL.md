---
name: grill-with-docs
description: Challenge the plan against the existing domain model, sharpen terminology, and update CONTEXT.md and ADRs inline as decisions crystallise; use when stress-testing a plan against documented language and decisions.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Grill With Docs (Domain Modeling & Architectural Alignment)

Interview the design tree one question at a time with recommended answers; explore the codebase instead of asking.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Stress-testing a plan against domain language and documented decisions. |
| **Expected Output** | Structured interview; inline `CONTEXT.md` updates; ADR handoff. |
| **State Mutations** | Writes `CONTEXT.md` and ADRs at resolved locations. |
| **Enforcement Gate** | Pure glossary; ADRs meet the 3-part bar; hand to `to-spec` after. |

## Workflow

1. Resolve storage (root `CONTEXT-MAP.md` wins); else `node "to-spec/scripts/check-project-docs.js" check` or inspect `docs/adr/` / `docs/`; else `.github/harness-everything/adr/` (or `.claude/…`, `.cursor/…`). Formats: [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) · [ADR-FORMAT.md](./ADR-FORMAT.md)
2. Challenge glossary conflicts; sharpen fuzzy terms to canonical ones.
3. Stress-test relationships with concrete scenarios; cross-check claims against code.
4. Update `CONTEXT.md` inline, never batch; zero implementation details.
5. Offer an ADR only if hard to reverse + surprising without context + a real trade-off.
6. Hand off: unverified design → `grill-me`; aligned → `to-spec/SKILL.md` publishes; execution → `to-tickets`/`fable-mode`/`tdd`.

Deep dive: references/session-playbook.md

## USE FOR:
- stress-testing plans against the domain model
- resolving fuzzy domain terminology
- capturing decisions into CONTEXT.md/ADRs inline

## DO NOT USE FOR:
- verifying unstable designs (`grill-me`)
- spec publishing without a grilling pass