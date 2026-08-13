# Workflow: Self-Evolve

> Analyzes execution logs and session memories to extract underlying root causes, defining new error boundaries and compressing them into cognitive guardrails.

---

## 1. Skill Behavior Workflow

This section visualizes how the `self-evolve` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Task Completed / Error Loop Triggered]) --> ReadSessionLogs["Read active debugging logs & session history"]
  ReadSessionLogs --> IdentifyRootCauses["Isolate and extract system failures or bottlenecks"]
  IdentifyRootCauses --> CheckWorkspaceMem{Detect Workspace Memory Architecture?}
  
  CheckWorkspaceMem -->|Found MEMORY.md / RULES.md| CheckLines{Check Target File Line Count}
  CheckWorkspaceMem -->|Not Found / Script Available| RunScript["Run self-evolve/scripts/persist-memory.js"]
  
  CheckLines -->|< 60 Lines| DirectAppend["Append Rule directly to MEMORY.md / RULES.md"]
  CheckLines -->|≥ 60 Lines| ModularSplit["Categorize & Create Sub-memory File (memories/rules/topic.md)"]
  ModularSplit --> AddIndexPointer["Add 1-Line Index Link to Primary MEMORY.md for Lazy Loading"]
  
  RunScript --> CheckLines
  DirectAppend --> End([Agent cognitive defense expanded])
  AddIndexPointer --> End
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `self-evolve` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  SessionEnd["Task Completed / Session Closed"] --> Evolve["self-evolve / SKILL.md"]
  Evolve -->|Reads from| HistoryLog["VS Code Debug logs & memory directories"]
  Evolve -->|Writes permanent updates to| UserMemory["/memories/ / user-memory files"]
  Evolve -->|If Complex Skill, registers in| Manifest["manifest.json 'generated' registry"]
  Manifest -->|Scanned & matched by| Router["harness-everything / tier-router.js"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `self-evolve` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Session ends after solving a recurring, messy Windows path-slashes bug"] --> Trigger["self-evolve skill runs automatically"]
  Trigger --> Analyze["Reads last 5 execution logs"]
  Analyze --> DetectPattern["Finds 3 consecutive terminal command failures caused by path backslashes in PowerShell"]
  DetectPattern --> Formulate["Formulate new guardrail: 'When on Windows, convert backslashes to forward slashes for cross-shell command lines'"]
  Formulate --> Decide{"Is it a complex structural pattern or a simple rule?"}
  Decide -->|Simple Rule| Write["Write simple rule to /memories/repo/RULES.md"]
  Decide -->|Complex Skill| Register["Package as dynamic skill & run register-dynamic-skill.js to write to manifest.json 'generated'"]
  Write --> Done([Memory recorded: future sessions will automatically avoid errors])
  Register --> Done([Memory & dynamic skill recorded: future sessions will automatically discover and load via tier-router.js])
```

---

## 4. Verification Check

To ensure that the `self-evolve` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
