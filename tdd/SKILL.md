---
name: tdd
description: "Drive Standard Tasks (Tier 2) with Test-Driven Development (RED/GREEN/REFACTOR) backed by terminal test evidence. USE FOR: \"implement a feature test-first\", \"fix a bug with a regression test\", \"refactor safely under tests\". DO NOT USE FOR: \"macro planning or scaffolding\", \"docs-only work with no testable logic\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Test-Driven Development (TDD) Mode

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger** | Tier 2 task; feature or bug requirement. |
| **Output** | Failing test (RED), minimal code (GREEN), refactor. |
| **Mutations** | TODO tracker (`todo-cli.js`, `tasks/todo.md`). |
| **Gate** | `npm test` / `pytest`; >3 GREEN failures force `zoom-out`. |

## TDD Discipline (Red-Green-Refactor)

Every phase obeys the **Evidence Assertion Law**: real test logs prove pass/fail; assumed passes are PROHIBITED.

1. **RED**: write the failing test; confirm it fails (a pass means wrong test or no bug).
2. **GREEN**: minimal code just enough to pass; re-run until green.
3. **REFACTOR**: optimize naming/duplication/performance with green tests. **Code-Doc Alignment Law**: code matches contracts, no cheating mocks; audit vs `todo-driven-workflow` checklist; re-run tests each change.

## Circuit Breaker
3 straight GREEN failures: call `zoom-out`; fact-check each attempt's assumptions (including the RED test's own expectation); resume fresh; human only for genuine decisions.

Guides: `tdd/guides/{mocking,interface-design,deep-modules,tests,refactoring}.md`.

## USE FOR:
- implement this feature test-first
- fix this bug with a regression test
- prove this change works
- refactor safely under tests

## DO NOT USE FOR:
- macro planning or scaffolding (use `fable-mode`)
- prototyping or docs-only work with no testable logic

Deep dive: references/core-discipline.md
