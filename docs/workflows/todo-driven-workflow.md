# Workflow: Todo-Driven Workflow

> Enforces a deliberate, step-by-step execution loop using the manage_todo_list tool to break down complex tasks, track exact state, and prevent hallucinated progress.

---

## 1. Skill Behavior Workflow

This section visualizes how the `todo-driven-workflow` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Initialize Checklist]) --> Plan["Define 3-7 Verifiable Sub-tasks"]
  Plan --> SaveTodo["Write to manage_todo_list as 'not-started'"]
  SaveTodo --> ChooseTask["Pick exactly ONE task to work on"]
  ChooseTask --> MarkInProgress["Mark task as 'in-progress'"]
  MarkInProgress --> Execute["Perform work for that task"]
  Execute --> GatherEvidence["Gather objective evidence of success"]
  GatherEvidence --> VerifySuccess{Verification Passed?}
  VerifySuccess -->|Yes| MarkCompleted["Mark task as 'completed'"]
  VerifySuccess -->|No| InsertBlocker["Insert specific Blocker Todo as 'not-started'"]
  InsertBlocker --> ChooseTask
  MarkCompleted --> CheckRemaining{All tasks completed?}
  CheckRemaining -->|No| ChooseTask
  CheckRemaining -->|Yes| Finish([Signal Task Completion])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `todo-driven-workflow` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  TierRouter["harness-everything / tier-router.js"] -->|Requires Tier 2 or Tier 3| TodoSkill["todo-driven-workflow / SKILL.md"]
  TodoSkill -->|Tracks execution state for| ExecutionSkills["tdd / fable-mode"]
  ExecutionSkills -->|Sub-task verifications done via| Verification["verification-loop / verify-before-claim"]
  Verification -->|Updates item state to completed in| TodoSkill
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `todo-driven-workflow` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Requirement: Implement User Login Endpoint"] --> InitTodo["Init checklist: 1. Unit Tests, 2. Logic, 3. DB, 4. E2E"]
  InitTodo --> Work1["Mark item 1 'Write unit tests' in-progress"]
  Work1 --> Exec1["Create tests & run them"]
  Exec1 --> Complete1["Mark item 1 completed"]
  Complete1 --> Work2["Mark item 2 'Implement endpoint logic' in-progress"]
  Work2 --> Exec2["Write handler code & run tests"]
  Exec2 --> TestFail["Tests fail: 'Missing bcrypt dependency'"]
  TestFail --> AddBlocker["Insert Blocker: 'Install & configure bcrypt'"]
  AddBlocker --> WorkBlocker["Mark Blocker in-progress"]
  WorkBlocker --> ExecBlocker["Install bcrypt & run build"]
  ExecBlocker --> VerifyBlocker["Verify build success"]
  VerifyBlocker --> CompleteBlocker["Mark Blocker completed"]
  CompleteBlocker --> Resume2["Resume item 2 'Implement endpoint logic'"]
  Resume2 --> Done([All items completed & objectively verified])
```

---

## 4. Verification Check

To ensure that the `todo-driven-workflow` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
