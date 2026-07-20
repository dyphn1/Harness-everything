# Workflow: Test-Driven Development (TDD)

> Enforces the classic Red-Green-Refactor development cycle to verify code correctness incrementally and maintain clean codebases.

---

## 1. Skill Behavior Workflow

This section visualizes how the `tdd` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Identify Feature / Bug]) --> DesignInterface["Design interface & contract"]
  DesignInterface --> WriteTest["Write unit/integration tests first"]
  WriteTest --> RunRed["Run tests & verify they FAIL - RED"]
  RunRed --> WriteCode["Write minimal code to make tests pass"]
  WriteCode --> RunGreen["Run tests & verify they PASS - GREEN"]
  RunGreen --> Refactor["Refactor code for readability/coupling"]
  Refactor --> RunVerify["Run tests to verify refactoring maintains GREEN"]
  RunVerify --> End([Feature verified & completed])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `tdd` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: tdd / test / mock| TDDSkill["tdd / SKILL.md"]
  TDDSkill -->|Uses for environment & runner| Env["environment-detection / SKILL.md"]
  TDDSkill -->|Uses for mock design| MockGuide["tdd / guides / mocking.md"]
  TDDSkill -->|Uses for post-implementation verification| VerLoop["verification-loop / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `tdd` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Task: Add custom discount rule to shopping cart"] --> Design["Define CartDiscount interface"]
  Design --> WriteT["Write test: 'applying VIP rule gives 10% discount'"]
  WriteT --> RunFail["Run test -> Fails because VIP rule class is missing"]
  RunFail --> WriteMin["Implement minimal CartDiscountVIP class"]
  WriteMin --> RunPass["Run test -> Passes successfully"]
  RunPass --> Clean["Refactor VIP class to use common base calculations"]
  Clean --> RunFinal["Run tests -> Still passes successfully"]
  RunFinal --> Done([TDD loop completed safely])
```

---

## 4. Verification Check

To ensure that the `tdd` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
