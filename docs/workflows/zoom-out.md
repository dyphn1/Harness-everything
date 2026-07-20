# Workflow: Zoom Out

> High-level reflection report generation to break out of error loops, analyze failure patterns, and backtrack to alternative paths.

---

## 1. Skill Behavior Workflow

This section visualizes how the `zoom-out` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([3 Consecutive Errors Triggered]) --> Tripped{Rule of 3 Tripped?}
  Tripped -->|No| Backtrack["Review code change and retry"]
  Tripped -->|Yes| LockWork["Lock all file edit capabilities"]
  LockWork --> GatherState["Analyze current working directory, file states, and errors"]
  GatherState --> GenReport["Compile formal Reflection Report: what failed, assumptions, backtracking options"]
  GenReport --> PresentReport["Present report to human partner and request guidance"]
  PresentReport --> End([Workforce unlocked after human direction received])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `zoom-out` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  RuleOf3["Rule of 3 Circuit Breaker"] -->|Tripped!| ZoomOut["zoom-out / SKILL.md"]
  ZoomOut -->|Halts execution for| ActiveWork["Active workspace edits"]
  ZoomOut -->|Asks for human direction via| AskQuestions["vscode_askQuestions"]
  ZoomOut -->|Unlocks workspace state after| HumanReset["Human Partner Response"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `zoom-out` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Attempting to fix Python import error; fails 3 times consecutively with same trace"] --> Trigger["Rule of 3 circuit breaker trips"]
  Trigger --> Lock["Workspace writes locked"]
  Trigger --> Collect["Collect error traces and diff history"]
  Collect --> WriteReport["Create docs/reflection/zoom-out-report.md detailing the import cyclic dependency"]
  WriteReport --> Present["Present options to human: Option A - Merge imports, Option B - Extract shared modules"]
  Present --> UserChoice["User select: 'Option B'"]
  UserChoice --> Unlock["Unlock workspace and execute Option B"]
  Unlock --> Done([Error loop successfully broken and resolved])
```

---

## 4. Verification Check

To ensure that the `zoom-out` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
