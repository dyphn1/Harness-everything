# Workflow: Harness Everything

> Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Not general Q&A or non-software writing.

Source of truth: `harness-everything/SKILL.md`. Deep dive: `harness-everything/references/triage-and-tiers.md`.

---

## 1. Skill Behavior Workflow

The kernel establishes the smallest applicable workflow before mutation. Suggested skills are mandatory to evaluate and advisory to execute; the selected topology is mandatory to resolve.

```mermaid
graph TD
  Start([User Prompt Received]) --> CheckSoftware{Software / Engineering Task?}
  CheckSoftware -->|No: Pure Chat / Translation / Web Search| BypassHarness["Bypass Harness Completely - Reply Directly"]
  CheckSoftware -->|Yes: Code / Architecture / Project| ExecuteRouter["Run kernel-router.js OR reuse UserPromptSubmit hook output"]
  ExecuteRouter --> TriageTier{Triage Tier}
  TriageTier -->|Tier 1: Trivial| Tier1Route["direct-single: smallest sufficient tactic"]
  TriageTier -->|Tier 2: Standard| Tier2Route["iterative-single: verify each increment"]
  TriageTier -->|Tier 3: Macro| Tier3Route["fable-staged / fable-parallel / fable-multi-agent-workspace"]
  Tier1Route --> Checkpoint["Surface Harness Routing Checkpoint"]
  Tier2Route --> Checkpoint
  Tier3Route --> Checkpoint
  Checkpoint --> Evaluate["Read each suggested SKILL.md: USE FOR, DO NOT USE FOR, flow, hard rules"]
  Evaluate --> Execute["Execute selected topology to resolution"]
  Execute --> VerifyGate{Objective evidence supports completion?}
  VerifyGate -->|Yes| Done([Evidence-backed completion])
  VerifyGate -->|No| Diagnose["Diagnose / bounded re-plan"]
  Diagnose --> RetryCheck{Same-signature failure x3?}
  RetryCheck -->|No| Execute
  RetryCheck -->|Yes| ZoomOut["zoom-out: stop edits, rebuild facts read-only, report RESUME or ESCALATE"]
  ZoomOut --> Execute
```

---

## 2. Triggering and Routing Path

This diagram shows how the `harness-everything` skill is triggered and how it chains with companion skills. Routing suggestions are conditional on applicability; the selected topology is not advisory.

```mermaid
graph LR
  UserPrompt([User Input]) --> Router["harness-everything / kernel-router.js + tier-router.js"]

  Router -->|Bug / Feature / Refactor| Ch1["tdd + todo-driven-workflow + verification-loop + verify-before-claim"]
  Router -->|Commit / History / Isolation| Ch2["git-commit + rewrite-commits + using-git-worktrees + verification-loop"]
  Router -->|Large / Multi-source / Multi-session| Ch3["fable-mode + fable-discipline + multi-agent-workspace + using-git-worktrees"]
  Router -->|Architecture / Plan review| Ch4["improve-codebase-architecture + grill-me + grill-with-docs + to-spec + to-tickets"]

  Ch1 --> Invariants["Invariants: route-before-execution, verify-before-claim, re-plan-after-x3, evaluate-before-skip, resolve-selected-workflow"]
  Ch2 --> Invariants
  Ch3 --> Invariants
  Ch4 --> Invariants

  style Router fill:#d35400,stroke:#e67e22,stroke-width:2px,color:#ffffff
  style Invariants fill:#1abc9c,stroke:#16a085,stroke-width:2px,color:#ffffff
```

---

## 3. Real-World Use Case Flowchart

```mermaid
graph TD
  Input1["User: 'Add a new settings page'"] --> Router1["kernel-router.js executes"]
  Router1 --> Triage2["Triaged as Tier 2: Standard Task"]
  Triage2 --> Checkpoint1["Routing Checkpoint: tdd, todo-driven-workflow, verification-loop suggested"]
  Checkpoint1 --> Eval1["Read each suggested SKILL.md; keep applicable, mark not-applicable with flow-grounded reason"]
  Eval1 --> Exec1["Execute iterative-single to resolution; verify with tests before claiming done"]
  Exec1 --> Done1([Feature delivered with objective evidence])

  Input2["User: 'Refactor DB architecture across services'"] --> Router2["kernel-router.js executes"]
  Router2 --> Triage3["Triaged as Tier 3: Macro Task"]
  Triage3 --> Iso["Verify linked Git worktree isolation before source mutation"]
  Iso --> Exec2["fable-mode stage map + per-stage checks + cold verification"]
  Exec2 --> Done2([Staged delivery with per-stage evidence])

  Input3["User: 'Just fix this typo'"] --> Router3["kernel-router.js executes"]
  Router3 --> Triage1["Triaged as Tier 1: Trivial Task"]
  Triage1 --> Exec3["direct-single: smallest sufficient edit, then verify"]
  Exec3 --> Done3([Typo fixed, no ceremony added])
```

Escape applies only to genuinely uncovered workflow scope with explicit scope + evidence; covered obligations, isolation, and independent verification survive escape. Model confidence alone never justifies skipping the selected topology.

---

## 4. Verification Check

To ensure that the `harness-everything` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Route before execution**: scope/tier and smallest applicable workflow established before mutation.
- [ ] **Evaluate before omission**: each suggested skill's complete `SKILL.md` flow evaluated before deciding applicability.
- [ ] **Resolve selected workflow**: the selected topology executed to resolution; escape only for uncovered scope with evidence.
- [ ] **Verify before claim**: objective evidence (tests, checks, quoted tool output) supports completion.
- [ ] **Re-plan on repetition**: after 3 same-signature failures, `zoom-out` reflection completed before resuming.
