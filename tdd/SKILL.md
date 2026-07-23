---
name: tdd
description: Test-Driven Development mode (Red-Green-Refactor) for Standard Tasks (Tier 2).
author: Miya Daniel | Harness Core Team
version: 0.2.0
---

# Test-Driven Development (TDD) Mode

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 2 Task identification. Input: The specific feature or bug requirement. |
| **Expected Output** | 1. Failing test terminal output. 2. Implementation code. 3. Passing test terminal output (Exit Code 0). |
| **State Mutations** | Handled by `todo-cli.js` (tracked via `.claude/harness-state/todo-state.json`). |
| **Enforcement Gate** | You MUST run the test runner in the terminal. If it does not fail first (RED), you MUST fix the test. If it fails later (GREEN phase), you MUST reflect and fix the code. |

This skill is automatically triggered and loaded by the `harness-everything` router when a task is judged as a **Tier 2 (Standard Task)**.
It applies to adding a single feature, fixing a specific Bug, or medium-sized changes with clear expected outcomes.

Tier 2 tasks run on the `todo-driven-workflow` base execution loop: initialize the checklist first, and map each Red / Green / Refactor phase (per feature or bug) onto its own verifiable todo item.

## TDD Core Discipline (Red-Green-Refactor)

When this skill is loaded, you MUST suppress the urge to write implementation code directly, and strictly follow these three phases:

### 1. RED (Write a Failing Test)
- **Action**: Before implementing the requested feature or Bug fix, write the corresponding Unit Test or Integration Test in the test folder.
- **Validation**: Run the test to **ensure the test fails** (this proves the test actually covers unimplemented functionality, rather than being a fake test).
- **Note**: If the test passes immediately, it means your test is wrong or the Bug doesn't actually exist. You must fix the test.

### 2. GREEN (Implement Minimal Code to Pass Test)
- **Action**: Switch to the implementation code and write the "minimum amount of code just enough to pass the test". Do not over-engineer or consider future extensibility at this stage.
- **Validation**: Run the test to ensure it passes.

### 3. REFACTOR (Refactor and Optimize)
- **Action**: Under the safety net of passing tests, begin optimizing the code.
- Checks: Is the naming clear? Is there duplicated code? Can performance be improved? Does it comply with the project's Clean Code standards?
- **Validation**: After every modification, re-run the tests to ensure refactoring hasn't broken the original functionality.

## Circuit Breaker Defense
If during a TDD cycle you get stuck in the **GREEN phase**, and 3 consecutive implementation attempts fail to pass the test:
- **Trigger Condition Met**: You might have hit the reasoning ceiling, or the initial test logic (RED) was written incorrectly.
- **Mandatory Action**: Stop guessing blindly. Immediately abort the TDD process and call the `zoom-out` skill: fact-check the assumption behind each failing attempt — including whether the RED test itself encodes the wrong expectation — and resume on a fresh diagnosis. Bring the human in only if the reflection surfaces a genuine decision (e.g., the test contradicts the requirement).

## Deep Reference Guides
For advanced testing, design, and mocking strategies, you MUST refer to:
- `tdd/guides/mocking.md` — Mocking and stubbing principles
- `tdd/guides/interface-design.md` — Interface and contract-driven design
- `tdd/guides/deep-modules.md` — Testing deeply nested/complex modules
- `tdd/guides/tests.md` — General test architecture and assertions
- `tdd/guides/refactoring.md` — Refactoring techniques under safety nets
