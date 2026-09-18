# Workflow: Verification Loop

> Run the objective gates — build, types, lint, tests, security, diff — and only claim done when the evidence-backed report passes.

Source of truth: `verification-loop/SKILL.md`.

Contract summary from SKILL.md — Trigger: completed implementation or change awaiting delivery. Output: evidence-backed verification report and delivery decision. USE FOR: verify a feature or change before delivery, run quality gates before a PR. DO NOT USE FOR: fixing failures without re-running the loop, writing new features or tests (use `tdd`).

## 1. Skill Behavior Workflow

```mermaid
graph TD
  Start[Completed Change Awaiting Delivery] --> Build[Gate1 Build npm run build]
  Build --> Types[Gate2 Types tsc noEmit or pyright]
  Types --> Lint[Gate3 Lint npm run lint or ruff]
  Lint --> Tests[Gate4 Tests npm run test coverage]
  Tests --> Security[Gate5 Security Secrets StrayLogs]
  Security --> Diff[Gate6 Diff git diff stat]
  Diff --> Report[Fill verification-report template]
  Report --> Decision{All Gates Pass?}
  Decision -->|yes| Deliver([Delivery Decision Ready])
  Decision -->|no| Fix[Fix Cause Rerun From First Affected Gate]
  Fix --> Build
```

## 2. Triggering and Routing Path

```mermaid
graph TD
  VerifyReq[Run Full Verification Loop Request] --> Skill[verification-loop SKILL]
  DeliveryReq[Verify Before Delivery Request] --> Skill
  PRReq[Quality Gates Before PR] --> Skill
  DesignOnly[Design Discussion No Completed Work] --> Decline[Do Not Route]
  PlanOnly[Planning Without Code Changes] --> Decline
  NewWork[Write New Features Tests] --> TDD[tdd SKILL]
  Skill --> Gates[Build Type Lint Test Security Diff]
```

## 3. Real-World Use Case

```mermaid
graph TD
  Done[Feature Implemented Awaiting PR] --> B[Run npm run build]
  B -->|pass| T[Run npx tsc noEmit]
  T -->|fail| FixT[Fix Type Errors]
  FixT --> B
  T -->|pass| L[Run npm run lint]
  L -->|pass| TS[Run npm run test coverage]
  TS -->|pass| Sec[Check Secrets And Stray Logs]
  Sec --> D[Check git diff stat For Unintended Changes]
  D --> R[Fill templates verification-report template md]
  R --> PR[Report Evidence And Delivery Decision]
```

Template: `verification-loop/templates/verification-report.template.md`. Deep dive: `verification-loop/references/verification-phases.md`.

## 4. Verification Check

- [ ] No completion was claimed until every applicable gate passed
- [ ] Build gate ran (`npm run build`) with evidence recorded
- [ ] Type gate ran (`npx tsc --noEmit` or `pyright .`) with evidence recorded
- [ ] Lint gate ran (`npm run lint` or `ruff check .`) with evidence recorded
- [ ] Test and coverage gate ran (`npm run test -- --coverage`) with evidence recorded
- [ ] Security gate checked secrets and stray logs with evidence recorded
- [ ] Diff gate checked `git diff --stat` and unintended changes with evidence recorded
- [ ] `templates/verification-report.template.md` was filled with evidence, and any failure was fixed then rerun from the first affected gate rather than patched without a rerun
