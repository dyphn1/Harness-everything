# Workflow: Fable Mode

> Macro-task planning and execution engine designed for large, multi-file refactorings and structural architecture rewrites.

---

## 1. Skill Behavior Workflow

This section visualizes how the `fable-mode` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Tier 3 Macro Task Triggered]) --> InitFable["Initialize Fable Execution Context"]
  InitFable --> AnalyzeScope["Map system dependencies & files"]
  AnalyzeScope --> GenerateContract["Generate Contract detailing target edits, types, and APIs"]
  GenerateContract --> ReviewContract["Orchestrator and Challenger review contract constraints"]
  ReviewContract --> HumanConfirm["Present plan & Confirm with Human Partner"]
  HumanConfirm -->|Rejected| AnalyzeScope
  HumanConfirm -->|Approved| PlanSteps["Materialize plan into todo-driven-workflow checklist"]
  PlanSteps --> RunStep["Execute step: invoke specialized sub-agents or TDD loops"]
  RunStep --> VerifyStep["Verify step outcomes against expected state"]
  VerifyStep --> CheckAllSteps{All steps executed?}
  CheckAllSteps -->|No| RunStep
  CheckAllSteps -->|Yes| FinalAudit["Perform system-wide verification loop"]
  FinalAudit --> End([Macro rewrite successfully deployed])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `fable-mode` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: refactor / architecture / fable| Fable["fable-mode / SKILL.md"]
  Fable -->|Limits context and active tokens via| FD["fable-discipline / SKILL.md"]
  Fable -->|Delegates specialized sub-tasks via| CAL["create-agent-launcher / SKILL.md"]
  Fable -->|Maintains technical alignment via| GWD["grill-with-docs / SKILL.md"]
  Fable -->|Runs incremental validations using| TDD["tdd / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `fable-mode` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Task: Migrate auth system from session cookies to JWT"] --> Trigger["fable-mode skill launched"]
  Trigger --> DraftContract["Contract drawn: edit middleware, login, and UI state"]
  DraftContract --> HumanConfirm["Human reviews & approves architectural changes"]
  HumanConfirm --> Steps["Materialize milestone tasks in checklist"]
  Steps --> SpawnBackend["Spawn Backend Specialist sub-agent for middleware & tests"]
  SpawnBackend --> BackendReport["Sub-agent reports success & returns diff"]
  BackendReport --> SpawnFrontend["Spawn Frontend Specialist for React Context"]
  SpawnFrontend --> IntegrFail["Integration Check: CORS blocks new auth header"]
  IntegrFail --> FixCORS["Orchestrator inserts Blocker: 'Update CORS policy'"]
  FixCORS --> E2E["Run E2E Suite & verify success"]
  E2E --> Done([JWT migration complete, clean, and fully verified])
```

---

## 4. Verification Check

To ensure that the `fable-mode` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
