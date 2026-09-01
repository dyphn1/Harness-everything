# Workflow: Verify Before Claim

> Fact-audit discipline requiring empirical verification of external claims, SDK configurations, defaults, and unmeasured performance estimates.

---

## 1. Skill Behavior Workflow

This section visualizes how the `verify-before-claim` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([About to Assert External Framework / API Behavior or Perf Number]) --> CheckScope{Claim Scope Check}
  CheckScope -->|Internal Repo Code| ReadSource["Read Local Source Code -> State Facts"]
  CheckScope -->|External Framework / API / Number| CheckNet{Web Fetch / Search / Measurement Available?}
  
  CheckNet -->|Yes| FetchDocs["WebFetch Official Docs / Measure Real Execution"]
  CheckNet -->|No / Offline| EstimateFallback["Explicitly Label Response as Unverified Estimate"]
  
  FetchDocs --> CiteDocs["Quote Authoritative Source / State Measured Data"]
  ReadSource --> End([Verified Output Delivered])
  CiteDocs --> End
  EstimateFallback --> End
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `verify-before-claim` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Requires fact checking or estimates| VBC["verify-before-claim / SKILL.md"]
  VBC -->|Empirical verification helper| RunCode["Run a real Node/terminal measurement"]
  VBC -->|Secures quality of decisions in| GWD["grill-with-docs / SKILL.md"]
  VBC -->|Verifies assertions in testing suite| TDD["tdd / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `verify-before-claim` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Developer assumes: 'Node.js fs.rmSync returns boolean upon success'"] --> Trigger["verify-before-claim skill triggered"]
  Trigger --> ReadDocs["Checks Node.js documentation via WebSearch"]
  ReadDocs --> FindTrue["Discovers fs.rmSync returns 'undefined' on success, and throws on failure"]
  FindTrue --> TestCode["Executes quick Node snippet to confirm empirical behavior"]
  TestCode --> UpdateCode["Refactors proposed catch-blocks to handle exceptions instead of checking booleans"]
  UpdateCode --> Done([Potential production runtime crash prevented])
```

---

## 4. Verification Check

To ensure that the `verify-before-claim` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
