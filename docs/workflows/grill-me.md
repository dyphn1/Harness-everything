# Workflow: Grill Me

> Relentless Challenger interview process that stress-tests architectural plans, highlights hidden assumptions, and demands explicit edge-case handling.

---

## 1. Skill Behavior Workflow

This section visualizes how the `grill-me` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Developer Proposes Plan]) --> IntroduceChallenger["Introduce 'Challenger' adversarial persona"]
  IntroduceChallenger --> ProbeAssumptions["Analyze proposal and probe soft/mocked points"]
  ProbeAssumptions --> AskHardQuestions["Ask 3-5 aggressive, non-trivial stress-testing questions"]
  AskHardQuestions --> ReceiveAnswers["Developer provides details & arguments"]
  ReceiveAnswers --> ValidateResilience{Answers robust & handle failures?}
  ValidateResilience -->|No| GrillDeeper["Grill deeper on specific vulnerabilities"]
  ValidateResilience -->|Yes| DistillDecisions["Distill final agreed design decisions"]
  GrillDeeper --> ReceiveAnswers
  DistillDecisions --> End([Proposal approved and hardened against failures])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `grill-me` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: grill / debate / plan| GrillMe["grill-me / SKILL.md"]
  GrillMe -->|Writes final hardened agreements into| GWD["grill-with-docs / SKILL.md"]
  GrillMe -->|Directs macro execution strategies of| Fable["fable-mode / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `grill-me` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Proposal: 'I will write a fast cron job to sync database tables directly'"] --> Trigger["grill-me skill activated"]
  Trigger --> Challenger["Challenger SRE: 'What happens if the cron script fails mid-sync? Will there be database lock contention? How do we prevent partial/corrupt states?'"]
  Challenger --> Answer1["Dev: 'I'll add database transaction wraps and skip locks'"]
  Answer1 --> Challenger2["Challenger: 'How will we monitor and alert if locks are skipped repeatedly?'"]
  Challenger2 --> Answer2["Dev: 'I'll add structured logging and trigger a standard Slack web-hook alerting'"]
  Answer2 --> Approve["Challenger: 'Excellent. Let's record these lock-skip alerts as mandatory requirements.'"]
  Approve --> Done([Plan hardened and logged])
```

---

## 4. Verification Check

To ensure that the `grill-me` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
