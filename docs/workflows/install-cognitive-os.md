# Workflow: Install Cognitive OS

> Explain or explicitly apply the Harness cognitive policy: Discover, Think, Try, Summarize, Record. This skill is a human-readable/manual entry point, not an installer and not a required peer-skill selection.

Source of truth: `install-cognitive-os/SKILL.md`. Deep dive: `install-cognitive-os/references/cognitive-loop.md`.

The runtime invariant contract is established by supported host integrations independently of this skill. Domain skills never need to invoke this skill first as long as Harness invariants remain satisfied.

---

## 1. Skill Behavior Workflow

```mermaid
graph TD
  Start([Explicit request OR host without kernel context]) --> Discover["Discover: verify relevant workspace state with read-only tools"]
  Discover --> Think["Think: establish intent, scope, and failure modes"]
  Think --> Try["Try: make the smallest useful change and gather evidence"]
  Try --> Summarize["Summarize: ground conclusions in tool output"]
  Summarize --> FailCheck{Same-signature failure x3?}
  FailCheck -->|Yes| ZoomOut["zoom-out: stop edits, rebuild facts, report RESUME or ESCALATE"]
  FailCheck -->|No| Record["Record: persist milestones only when evidence supports them"]
  ZoomOut --> Think
  Record --> End([Evidence-grounded work, no fixed domain sequence])
```

This skill writes no installer state, deploys no hooks, and copies no skill directories. Workspace installation is owned by the general installer (`node scripts/installer.js`), not by this skill.

---

## 2. Triggering and Routing Path

```mermaid
graph LR
  Trigger["Explain policy / Apply loop manually / Debug cognitive behavior"] --> Skill["install-cognitive-os / SKILL.md"]
  Skill -->|No kernel context| Manual["Run Discover → Think → Try → Summarize → Record explicitly"]
  Skill -->|Kernel present| Policy["Treat as policy reference; domain skill proceeds directly"]
  Manual --> Gates["Gates: evidence before claims; re-plan after x3 same-signature failures"]
  Policy --> Gates

  style Skill fill:#d35400,stroke:#e67e22,stroke-width:2px,color:#ffffff
  style Gates fill:#1abc9c,stroke:#16a085,stroke-width:2px,color:#ffffff
```

---

## 3. Real-World Use Case Flowchart

```mermaid
graph TD
  Case1["User on advisory-only host: 'walk me through the loop'"] --> Explain["Explain Discover → Think → Try → Summarize → Record with a small example"]
  Explain --> Done1([User can apply the loop manually])

  Case2["Host without automatic kernel context"] --> Apply["Apply the five steps explicitly to the task at hand"]
  Apply --> Done2([Work proceeds with evidence gates, no hook installation claimed])

  Case3["User asks for domain work: 'implement feature X test-first'"] --> Direct["Proceed directly with tdd; this skill is NOT a prerequisite"]
  Direct --> Done3([Domain skill executes under Harness invariants])
```

## 4. Verification Check

To ensure that the `install-cognitive-os` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Policy, not installation**: no hook deployment, file copying, or config mutation claimed as this skill's effect.
- [ ] **Full five-step loop**: Discover → Think → Try → Summarize → Record applied in order, not the truncated four-step variant.
- [ ] **Evidence gates honored**: completion claims need evidence; repeated same-signature failures require re-planning via `zoom-out`.
- [ ] **No prerequisite fabrication**: domain skills (`tdd`, `security-review`, `repo-docs`) proceed without selecting this skill first.
