# Workflow: Self-Evolve

> Analyzes execution logs and session memories to extract underlying root causes, defining new error boundaries and compressing them into cognitive guardrails.

---

## 1. Skill Behavior Workflow

This section visualizes how the `self-evolve` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Task Completed / Error Loop Triggered]) --> ReadSessionLogs["Read active debugging logs & session history"]
  ReadSessionLogs --> IdentifyRootCauses["Isolate and extract system failures or bottlenecks"]
  IdentifyRootCauses --> SynthesizeGuardrails["Formulate actionable high-level cognitive guardrails"]
  SynthesizeGuardrails --> CompressMemories["Compress repetitive events into compact markdown files in /memories/"]
  CompressMemories --> UpdateUserMemory["Commit lessons learned to user memory space"]
  UpdateUserMemory --> End([Agent cognitive defense expanded for future sessions])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `self-evolve` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  SessionEnd["Task Completed / Session Closed"] --> Evolve["self-evolve / SKILL.md"]
  Evolve -->|Reads from| HistoryLog["VS Code Debug logs & memory directories"]
  Evolve -->|Writes permanent updates to| UserMemory["/memories/ / user-memory files"]
  Evolve -->|Informs future task triage in| Router["harness-everything / tier-router.js"]
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
  Formulate --> Write["Write bullet point to /memories/debugging.md"]
  Write --> Done([Memory recorded: future sessions will automatically avoid Windows path errors])
```

---

## 4. Verification Check

To ensure that the `self-evolve` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
