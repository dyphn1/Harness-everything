---
name: tdd
description: Test-Driven Development mode (Red-Green-Refactor) for Standard Tasks (Tier 2).
---

# Test-Driven Development (TDD) Mode

This skill is automatically triggered and loaded by the `harness-everything` router when a task is judged as a **Tier 2 (Standard Task)**.
It applies to adding a single feature, fixing a specific Bug, or medium-sized changes with clear expected outcomes.

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
- **Mandatory Action**: Stop guessing blindly. Immediately abort the TDD process and call the `zoom-out` skill, presenting the test failure logs to the human for judgment.
