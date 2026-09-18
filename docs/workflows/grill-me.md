# Workflow: Grill Me

> A demanding challenger that pressure-tests vague plans and architectures one question at a time, exposes loopholes and undefined boundaries, counters sycophantic agreement, keeps the CONTEXT.md glossary current, and passes settled decisions to to-spec for formal specs and ADRs.

Source of truth: `grill-me/SKILL.md`.

## 1. Skill Behavior Workflow

```mermaid
graph TD
  Propose["Vague plan or architecture proposal received"] --> Discover["Scan plan code plus CONTEXT.md, README.md, docs/adr/"]
  Discover --> DomainTerms["Grill using project domain model and terminology"]
  DomainTerms --> AskOne["Ask exactly ONE question with attached insight"]
  AskOne --> ResolveBranch["Resolve decision-tree branch before moving on"]
  ResolveBranch --> UpdateGlossary["Update CONTEXT.md glossary inline"]
  UpdateGlossary --> ConsensusCheck{"Consensus on all branches?"}
  ConsensusCheck -->|No| AskOne
  ConsensusCheck -->|Yes| HandoffSpec["Hand off to to-spec to preview outline and publish"]
  HandoffSpec --> RouteExec["Route execution to to-tickets, fable-mode, or tdd"]
```

## 2. Triggering and Routing Path

```mermaid
graph LR
  VaguePlan["Input: vague plan proposal"] --> GrillMe["grill-me / SKILL.md"]
  EvaluateArch["Input: evaluate architecture request"] --> GrillMe
  ExplicitAsk["Input: explicit grill me request"] --> GrillMe
  GrillMe --> ToSpec["to-spec: preview outline and publish PRD, CLI/API reference, Schema doc, or ADR"]
  ToSpec --> ToTickets["to-tickets for execution"]
  ToSpec --> FableMode["fable-mode for execution"]
  ToSpec --> TDD["tdd for execution"]
```

## 3. Real-World Use Case

```mermaid
graph TD
  CronProposal["Proposal: nightly cron syncs tables directly"] --> GrillStart["grill-me starts single-question loop"]
  GrillStart --> Q1["Q1: What happens on mid-sync failure with locks held?"]
  Q1 --> A1["Answer: wrap in transactions, define lock behavior"]
  A1 --> Glossary1["Update CONTEXT.md glossary for sync and lock terms"]
  Glossary1 --> Q2["Q2: What are boundary conditions for partial state?"]
  Q2 --> Consensus["Consensus reached on failure and boundary handling"]
  Consensus --> SpecHandoff["to-spec publishes ADR and spec"]
```

Concrete example: a developer proposes a direct table-sync cron job. `grill-me` scans `CONTEXT.md` and related code, asks one question about mid-sync failure, resolves it, updates the glossary, asks the next question about monitoring and boundary conditions, then hands the hardened decisions to `to-spec` for a PRD or ADR. Execution follows via `to-tickets`, `fable-mode`, or `tdd`.

Deep detail: `grill-me/references/grilling-playbook.md`.

## 4. Verification Check

- [ ] Exactly ONE question asked at a time; questionnaires prohibited
- [ ] Each question carries the agent's insight and its branch is resolved before advancing
- [ ] Questions use the project's domain model and terminology from `CONTEXT.md`, `README.md`, and `docs/adr/`
- [ ] `CONTEXT.md` glossary updated inline as terms resolve; document creation left to `to-spec`
- [ ] On consensus, `to-spec` invoked to preview outline and publish PRD, CLI/API reference, Schema doc, or ADR
- [ ] No code implementation or ticket breakdown inside this skill; execution routed to `to-tickets`, `fable-mode`, or `tdd`
- [ ] Not used for casual Q and A, direct spec writing, or ticket breakdown of an approved spec
