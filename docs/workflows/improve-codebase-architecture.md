# Workflow: Improve Codebase Architecture

> Finds deepening opportunities in the codebase, consolidating tightly-coupled modules and mapping dependencies visually using Mermaid diagram reports.

---

## 1. Skill Behavior Workflow

This section visualizes how the `improve-codebase-architecture` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Audit Request / Refactoring]) --> ScanDirectories["Scan code directories for coupling"]
  ScanDirectories --> IdentifyTightlyCoupled["Locate highly coupled modules / wide files"]
  IdentifyTightlyCoupled --> DeepModuleTest["Analyze modules against Deep Module Design rules"]
  DeepModuleTest --> DefineSeams["Identify clean seams & write interface abstractions"]
  DefineSeams --> GenMermaidReport["Generate visual HTML / Mermaid codebase dependency map"]
  GenMermaidReport --> ProposeDecomposition["Formulate restructuring and extraction proposal"]
  ProposeDecomposition --> End([Actionable refactoring strategy compiled])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `improve-codebase-architecture` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: refactor / architecture / couple| ICA["improve-codebase-architecture / SKILL.md"]
  ICA -->|Deductions challenged by SRE via| GrillMe["grill-me / SKILL.md"]
  ICA -->|Guides large-scale structural rewrites in| Fable["fable-mode / SKILL.md"]
  ICA -->|Extracts interfaces to simplify unit tests in| TDD["tdd / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `improve-codebase-architecture` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Monolithic file 'utils.js' handles email, token creation, DB pooling, and logging"] --> Trigger["improve-codebase-architecture skill analyzed"]
  Trigger --> Audit["Analyzes dependency graphs and calculates coupling scores"]
  Audit --> FindSeams["Identifies three distinct interfaces: IEmailService, ITokener, IDbPool"]
  FindSeams --> GenMermaid["Output detailed Mermaid diagram visualizing the proposed separated structure"]
  GenMermaid --> RefactorPlan["Drafts multi-stage module extraction plan"]
  RefactorPlan --> Done([Clear, modular architectural blueprint established])
```

---

## 4. Verification Check

To ensure that the `improve-codebase-architecture` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
