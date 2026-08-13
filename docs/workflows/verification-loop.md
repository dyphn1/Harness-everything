# Workflow: Verification Loop

> Comprehensive pre-PR quality gate executing builds, linting, type-checking, test suites, and security scans before claiming a task complete.

---

## 1. Skill Behavior Workflow

This section visualizes how the `verification-loop` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Pre-PR Quality Check Triggered]) --> RunBuild["1. Phase 1: Build Verification"]
  RunBuild --> RunTypeCheck["2. Phase 2: Type Check (tsc / pyright)"]
  RunTypeCheck --> RunLint["3. Phase 3: Lint Check"]
  RunLint --> RunTests["4. Phase 4: Test Suite Execution"]
  RunTests --> RunSecurity["5. Phase 5: Security & Secret Scan"]
  RunSecurity --> DiffReview["6. Phase 6: Diff Review"]
  
  DiffReview --> CheckScript{7. Is verify-gate.js / Template Available?}
  CheckScript -->|Yes| ScriptReport["Run harness-everything/scripts/verify-gate.js & Fill Template"]
  CheckScript -->|No| DirectReport["Output Verification Report Inline"]
  
  ScriptReport --> CheckGate{All Verification Gates Passed?}
  DirectReport --> CheckGate
  
  CheckGate -->|No| FixIssues["Fix Issues in Code & Re-verify"] --> RunBuild
  CheckGate -->|Yes| End([Pre-PR Verification Gate Cleared])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `verification-loop` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Pre-PR checks / gate| VerLoop["verification-loop / SKILL.md"]
  VerLoop -->|Guards finalize step in| Todo["todo-driven-workflow / SKILL.md"]
  VerLoop -->|Requires test environment setup from| Env["environment-detection / SKILL.md"]
  VerLoop -->|Precedes safe commit push in| GitCommit["git-commit / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `verification-loop` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Feature code written; ready to claim task complete"] --> Trigger["verification-loop skill runs"]
  Trigger --> Build["Run 'npm run build' -> Succeeded"]
  Build --> Type["Run 'npm run typecheck' -> Found 2 type mismatches in routes.ts"]
  Type --> FixT["Fix incorrect type casting in routes.ts"]
  FixT --> Recheck["Re-run typecheck -> Succeeded"]
  Recheck --> Lint["Run 'npm run lint' -> Clean"]
  Lint --> Tests["Run 'npm run test' -> 24 tests passed"]
  Tests --> Done([Verification loop complete; safe to open PR])
```

---

## 4. Verification Check

To ensure that the `verification-loop` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
