# Workflow: Harness Everything

> The single entry point and dynamic router of Harness OS, triaging tasks into appropriate tiers and auto-loading synergistic knowledge guides.

---

## 1. Skill Behavior Workflow

This section visualizes how the `harness-everything` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([User Prompt Received]) --> ExecuteRouter["Execute tier-router.js OR check UserPromptSubmit hook output"]
  ExecuteRouter --> DetectNewFeature{Contains new logic/files?}
  DetectNewFeature -->|Yes, enforce Tier 2+| PreventDegrade["Prevent Silent Degrade to Tier 1"]
  PreventDegrade --> TriageTier
  DetectNewFeature -->|No| TriageTier{Triage Tier}
  
  TriageTier -->|Tier 1: Trivial| Tier1Route["Tier 1: Direct Edit No Checklist"]
  TriageTier -->|Tier 2: Standard| Tier2Route["Tier 2: TDD & Todo-driven work"]
  TriageTier -->|Tier 3: Macro| Tier3Route["Tier 3: Fable Planning & Agent Scaffolding"]
  
  Tier1Route --> LoadGuides["Auto-load & output Synergistic Guides"]
  Tier2Route --> LoadGuides
  Tier3Route --> LoadGuides
  
  LoadGuides --> FactCheck{External Claims / Estimates?}
  FactCheck -->|Yes| FactReminder["Append Fact-Audit Reminder"]
  FactCheck -->|No| FinalizeOutput["Finalize Routing Checkpoint Output"]
  FactReminder --> FinalizeOutput
  FinalizeOutput --> End([Developer proceeds with recommended workflow])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `harness-everything` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  UserPrompt([User Input]) --> Router["harness-everything / tier-router.js"]
  
  Router -->|Keyword Matches| Guides["Synergistic Workflow Guides"]
  
  Guides -->|TDD/Test/Bug| Ch1["tdd + environment-detection + verify-before-claim + verification-loop"]
  Guides -->|Git/Commit/PR| Ch2["git-commit + rewrite-commits + using-git-worktrees + verification-loop"]
  Guides -->|Agent/Fable/Macro| Ch3["fable-mode + fable-discipline + build-multi-agent-system + create-agent-launcher"]
  Guides -->|Refactor/Architecture| Ch4["improve-codebase-architecture + grill-with-docs + grill-me + fable-mode"]
  
  style Router fill:#d35400,stroke:#e67e22,stroke-width:2px,color:#ffffff
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `harness-everything` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Input1["User: 'Add a new settings page'"] --> Router1["tier-router.js executes"]
  Router1 --> TrapCheck["Trap Avoided: Feature request correctly blocked from Tier 1 degrade"]
  TrapCheck --> Triage2["Triaged as Tier 2: Standard Task"]
  Triage2 --> DomainSummon["Load 'tdd' & frontend Domain Experts"]
  DomainSummon --> BaseLoop["Initialize 'todo-driven-workflow' checklist"]
  BaseLoop --> VerifyGate["Complete feature & run 'verification-loop' pre-delivery gate"]
  VerifyGate --> Done1([Feature delivered safely with proof])
  
  Input2["User: 'Refactor DB architecture and grill my plan'"] --> Router2["tier-router.js executes"]
  Router2 --> Triage3["Triaged as Tier 3: Macro Task"]
  Triage3 --> RecGuides["Auto-load: improve-codebase-architecture, grill-with-docs, fable-mode"]
  RecGuides --> Process["Developer completes Grilling session to finalize ADRs"]
  Process --> Execute["fable-mode generates execution checklist & spawns sub-agents"]
```

---

## 4. Verification Check

To ensure that the `harness-everything` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
