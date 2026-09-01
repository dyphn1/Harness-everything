# Workflow: Fable Discipline

> Shadow guard for fable-mode preventing context bloat, enforcing physical boundaries, and preserving compact stage handoffs.

---

## 1. Skill Behavior Workflow

This section visualizes how the `fable-discipline` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Fable Task Initiated]) --> AuditContext["Audit active context against the stage contract"]
  AuditContext --> CheckTokenLimit{Context exceeds the active budget?}
  CheckTokenLimit -->|Yes| TrimContext["Evict raw logs, completed tasks, and non-essential file contents"]
  CheckTokenLimit -->|No| KeepState["Continue monitoring context state"]
  TrimContext --> EnforceLimit["Enforce physical boundary guidelines"]
  KeepState --> EnforceLimit
  EnforceLimit --> RecordHandoff["Record a compact stage handoff"]
  RecordHandoff --> End([Context maintained under safe, high-attention limits])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `fable-discipline` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Fable["fable-mode / SKILL.md"] -->|Monitors context on every turn| FD["fable-discipline / SKILL.md"]
  FD -->|Trims and prunes files from| ActiveContext["Active AI Session Context"]
  FD -->|Triggers high-level reflection when overloaded| ZoomOut["zoom-out / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `fable-discipline` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Fable-mode is editing a large monorepo with growing context"] --> Monitor["Fable-discipline analyzes active context"]
  Monitor --> TriggerPruning["Identifies raw logs & completed sub-task details"]
  TriggerPruning --> Clean["Evicts completed step details and logs from immediate active context"]
  Clean --> Compress["Summarizes historical state into the stage handoff"]
  Compress --> Done([Active context remains bounded while preserving required facts])
```

---

## 4. Verification Check

To ensure that the `fable-discipline` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
