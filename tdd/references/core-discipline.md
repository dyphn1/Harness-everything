# TDD — Core Discipline (Full Detail)

## Process & TDD Execution Flow

Follow the decision matrix below when conducting TDD:

```mermaid
flowchart TD
    Start[Trigger: Tier 2 Feature / Bugfix Task] --> Red[1. RED: Write Failing Unit/Integration Test]
    Red --> TestRunner{Run Project Test Runner}

    TestRunner -- Tests Fail as Expected --> Green[2. GREEN: Write Minimal Code to Pass]
    TestRunner -- Tests Unexpectedly Pass --> FixTest[Fix Test Logic / Assertions] --> Red

    Green --> CheckPass{Re-run Test Runner}
    CheckPass -- Tests Pass --> Refactor[3. REFACTOR: Clean Code & Verify Alignments]
    CheckPass -- New evidence changes diagnosis --> ZoomOut[Optionally reassess with zoom-out]

    Refactor --> VerifyFinal[Re-run Tests & Mark Todo Complete]
    VerifyFinal --> Done[TDD Cycle Complete]
```

When this skill is loaded, you MUST suppress the urge to write implementation code directly, and strictly follow these three phases.

For public behavior, RED/GREEN evidence is necessary but not sufficient. Apply the machine-verifiable matrix, source-conformance policy, determinism comparison, and mandatory gates in the [quality model](quality-model.md) before completion.

**Evidence Assertion (Law of Evidence Assertion - 證據斷言定律)**:
During each TDD phase (RED, GREEN, REFACTOR), you MUST present actual terminal test execution logs showing the exact test failure or pass. Claiming progress or success based on "assumed" passes is strictly PROHIBITED; you must assert outcomes with hard, objective evidence.

### 1. RED (Write a Failing Test)
- **Action**: Before implementing the requested feature or Bug fix, write the corresponding Unit Test or Integration Test in the test folder.
- **Validation**: Run the test to **ensure the test fails** (this proves the test actually covers unimplemented functionality, rather than being a fake test).
- **Note**: If the test passes immediately, it means your test is wrong or the Bug doesn't actually exist. You must fix the test.

### 2. GREEN (Implement Minimal Code to Pass Test)
- **Action**: Switch to the implementation code and write the "minimum amount of code just enough to pass the test". Do not over-engineer or consider future extensibility at this stage.
- **Validation**: Run the test to ensure it passes.

### 3. REFACTOR (Refactor and Optimize)

**Code-Doc Alignment (Law of Code-Documentation Alignment - 程式碼與文件對齊定律)**:
In the REFACTOR phase, you MUST verify that the implemented code actually aligns with the documented contracts and doesn't contain hardcoded mocking to "finesse" or cheat the tests. Use the `todo-driven-workflow` checklist items to audit that your implementation aligns 100% with the requirement specifications.

- **Action**: Under the safety net of passing tests, begin optimizing the code.
- Checks: Is the naming clear? Is there duplicated code? Can performance be improved? Does it comply with the project's Clean Code standards?
- **Validation**: After every modification, re-run the tests to ensure refactoring hasn't broken the original functionality.

## Voluntary Reassessment
During any TDD phase, an agent may choose `zoom-out` when a result contradicts an assumption, exposes an unknown boundary, or leaves the next check unclear. Review the test, evidence, and attempted changes before selecting a next step. Continue when each iteration yields useful evidence and the next action remains justified; no count or report is required.
