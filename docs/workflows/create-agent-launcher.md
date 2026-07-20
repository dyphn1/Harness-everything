# Workflow: Create Agent Launcher

> Sub-agent generator for orchestrating multi-domain specialized agents to avoid token context waste and preserve developer focus.

---

## 1. Skill Behavior Workflow

This section visualizes how the `create-agent-launcher` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Complex Task Demands Division of Labor]) --> AssessComplexity{Too complex for 1 context?}
  AssessComplexity -->|No| Reject["Reject creation, resolve in current context via TDD"]
  AssessComplexity -->|Yes| DefinePersona["Define highly restrictive specialized sub-agent persona"]
  DefinePersona --> IsolateResources["Map exact, minimum file paths needed for sub-task"]
  IsolateResources --> SelectModel["Select cost-effective model based on task weight"]
  SelectModel --> WriteHandoff["Define strict input/output contract for sub-agent return report"]
  WriteHandoff --> LaunchAgent["Launch specialized sub-agent under isolated sandbox"]
  LaunchAgent --> MergeReport["Validate and merge sub-agent findings into main orchestrator"]
  MergeReport --> End([Sub-agent work verified and closed])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `create-agent-launcher` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Requires agent specialization| CAL["create-agent-launcher / SKILL.md"]
  CAL -->|Spawns agent on scaffolding provided by| BMAS["build-multi-agent-system / SKILL.md"]
  CAL -->|Plans agent tasks using macro planner| Fable["fable-mode / SKILL.md"]
  CAL -->|Limits child memory to prevent bloat via| FD["fable-discipline / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `create-agent-launcher` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Refactoring task involves SQL Schema migrations, Node endpoints, and React forms"] --> Trigger["create-agent-launcher skill executed"]
  Trigger --> SpawnDB["Spawn 'Database Architect': Only views 'schema.sql' and outputs raw SQL migration"]
  Trigger --> SpawnFE["Spawn 'Frontend Specialist': Only views 'Login.tsx' and outputs validated form code"]
  SpawnDB & SpawnFE --> Collect["Main orchestrator receives isolated, highly focused diff reports from both"]
  Collect --> Merge["Integrate changes and run integration testing"]
  Merge --> Done([Complex task completed with 70% lower token cost and zero context confusion])
```

---

## 4. Verification Check

To ensure that the `create-agent-launcher` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
