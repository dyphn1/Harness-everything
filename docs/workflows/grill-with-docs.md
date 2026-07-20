# Workflow: Grill with Docs

> Decision tracking, Glossary alignment, and ADR-driven (Architecture Decision Record) grilling to eliminate technical drift between code and documentation.

---

## 1. Skill Behavior Workflow

This section visualizes how the `grill-with-docs` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Plan Proposed against Domain]) --> ReadDomainModel["Read CONTEXT.md and existing ADRs"]
  ReadDomainModel --> ChallengeDrift["Examine plan for term drift or architectural violations"]
  ChallengeDrift --> UpdateGlossary["Refine and match terminology with current Glossary"]
  UpdateGlossary --> DraftADR["Draft formal Architecture Decision Record in ADR format"]
  DraftADR --> StressTestADR["Stress-test ADR against error boundaries and fail-safes"]
  StressTestADR --> WriteDocs["Commit ADR to docs/adr/ and update CONTEXT.md"]
  WriteDocs --> InjectTodos["Inject critical TODO: [CRITICAL BUG FIX] tags into corresponding code"]
  InjectTodos --> End([Code and documentation are perfectly aligned])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `grill-with-docs` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: adr / decision / glossary| GWD["grill-with-docs / SKILL.md"]
  GWD -->|Coordinates stress-tests using| GrillMe["grill-me / SKILL.md"]
  GWD -->|Aligns documentation during macro work in| Fable["fable-mode / SKILL.md"]
  GWD -->|Triggers todo tasks tracked by| Todo["todo-driven-workflow / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `grill-with-docs` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Requirement: Change notification retry rate limits"] --> Trigger["grill-with-docs skill invoked"]
  Trigger --> ReadDocs["Analyzes docs/adr/003-rate-limiting.md"]
  ReadDocs --> CheckDrift["Finds that proposed change violates the maximum overload protection limit"]
  CheckDrift --> RefinePlan["Plan updated to stay within the 003-rate-limiting contract"]
  RefinePlan --> CreateADR["Create docs/adr/008-notification-retries.md"]
  CreateADR --> SyncCode["Modify code and inject aligned TODO tags directly in code to maintain truth"]
  SyncCode --> Done([Zero architectural drift achieved])
```

---

## 4. Verification Check

To ensure that the `grill-with-docs` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
