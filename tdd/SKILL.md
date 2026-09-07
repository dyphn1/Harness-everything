---
name: tdd
description: "Drive Standard Tasks (Tier 2) with Test-Driven Development (RED/GREEN/REFACTOR) backed by terminal test evidence. USE FOR: \"implement a feature test-first\", \"fix a bug with a regression test\", \"refactor safely under tests\". DO NOT USE FOR: \"macro planning or scaffolding\", \"docs-only work with no testable logic\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Test-Driven Development

**ROUTER:** Select unit or integration evidence before RED/GREEN/REFACTOR.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 2 feature, bugfix, or behavior-preserving refactor. |
| **Expected Output** | RED/GREEN logs and a profile-tagged quality report. |
| **State Mutations** | Tests, implementation, TODO state, and optional report JSON. |
| **Enforcement Gate** | Project tests plus `npm run tdd:quality -- <evidence.json>`; exit 1 blocks completion. |

## USE FOR:
- implementing behavior test-first
- bug regression tests
- safe refactors under tests

## DO NOT USE FOR:
- macro planning or scaffolding
- docs-only or non-testable work

## Route the Behavior

Load `references/core-discipline.md` and the quality model, then only the unit or integration guide needed. Keep their applicability rules separate.

Deep dive: references/core-discipline.md

After three failed GREEN attempts, invoke `zoom-out` before another edit.
