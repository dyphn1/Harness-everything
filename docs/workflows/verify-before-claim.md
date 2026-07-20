# Workflow: Verify Before Claim

> Fact-audit discipline requiring empirical verification of external claims, SDK configurations, defaults, and unmeasured performance estimates.

---

## 1. Skill Behavior Workflow

This section visualizes how the `verify-before-claim` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Claim or Estimate Proposed]) --> IdentifyAssumptions["Isolate any claim or performance assumption"]
  IdentifyAssumptions --> QueryAuthoritative["Execute WebSearch or read local code sources"]
  QueryAuthoritative --> CrossVerify["Cross-verify details with authoritative documentation"]
  CrossVerify --> RunLocalExperiment["Run quick script to empirically test the assumption"]
  RunLocalExperiment --> CaptureResult["Log actual measured results and exit-codes"]
  CaptureResult --> AssertFact["Assert verified fact based on objective data"]
  AssertFact --> End([Hypothesis replaced with empirical truth])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `verify-before-claim` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Requires fact checking or estimates| VBC["verify-before-claim / SKILL.md"]
  VBC -->|Empirical verification helper| RunCode["mcp_provides_tool_pylanceRunCodeSnippet / run_in_terminal"]
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
