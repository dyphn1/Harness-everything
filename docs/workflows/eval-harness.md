# Workflow: Eval Harness

> Evaluates AI developer agent performance based on accuracy, resource efficiency, and anti-loop metrics.

---

## 1. Skill Behavior Workflow

This section visualizes how the `eval-harness` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Trigger: Benchmark / Evaluate Log]) --> ParseLog["1. Parse Log: Actions, Error Loops, Token Indicator"]
  ParseLog --> CalcRubric["2. Calculate Scores across 4 Dimensions (0-10)"]
  CalcRubric --> CheckScript{3. Is evaluate.js Executable?}
  
  CheckScript -->|Yes| RunScript["Run node eval-harness/scripts/evaluate.js"]
  CheckScript -->|No / Fails| FileFallback{"4. Markdown File Fallback"}
  
  FileFallback -->|evals/ Exists| WriteEvals["Save Scorecard to evals/scorecard.md"]
  FileFallback -->|No evals/ Folder| WritePlatform["Save Scorecard to .github/harness-everything/evals/scorecard.md"]
  
  RunScript --> End([Evaluation Scorecard Logged])
  WriteEvals --> End
  WritePlatform --> End
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `eval-harness` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Analyzes performance metrics| EH["eval-harness / SKILL.md"]
  EH -->|Synthesizes lessons learned for| Evolve["self-evolve / SKILL.md"]
  EH -->|Detects error loops triggering| ZoomOut["zoom-out / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `eval-harness` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Agent session finishes implementing a complete backend server"] --> Trigger["eval-harness skill executed"]
  Trigger --> Gather["Collects: 15 minutes elapsed, 32 tool calls, 45,000 tokens consumed"]
  Gather --> Score["Scores: Correctness 10/10, Resource Efficiency 9/10, Anti-loop 10/10"]
  Score --> Output["Generates benchmark report summarizing optimal execution speed and zero looping errors"]
  Output --> Done([Benchmark logged for project history])
```

---

## 4. Verification Check

To ensure that the `eval-harness` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
