# Workflow: Zoom Out

> Reflect-first breaker after three failures: stop edits, rebuild the full picture with read-only tools, write a fact-check report, then resume or escalate.

Source of truth: `zoom-out/SKILL.md`.

Contract summary from SKILL.md — Trigger: three same-signature failures or an explicit loop/rethink request. Output: fact-checked report ending in `RESUME` or `ESCALATE`. State: writes the session `zoom-out-report.md`; reset may clear breaker state. Gate: `hooks/scripts/rule-of-3.js` plus a valid report; reset only after the second cycle. USE FOR: "you are stuck in a loop", "the same error keeps failing", "rethink your assumptions". DO NOT USE FOR: routine single-failure debugging, greenfield planning without failures.

## 1. Skill Behavior Workflow

```mermaid
graph TD
  Third[Third Same Signature Failure] --> Stop[Stop Edits No User Ask Yet]
  Stop --> ReadOnly[ReadOnly Restate Goal Check Files Config Logs]
  ReadOnly --> Fill[Fill zoom-out-report template]
  Fill --> Decide{RESUME or ESCALATE?}
  Decide -->|untried path| Resume[RESUME On Untried Path]
  Decide -->|genuine user decision| Escalate[ESCALATE With Options]
  Resume --> Again{Repeated Breaker Cycle?}
  Again -->|second cycle| Reset[npm run harness reset]
  Reset --> Evolve[Record Insight With self-evolve]
  Again -->|no| Done([Report Complete])
  Escalate --> Done
```

## 2. Triggering and Routing Path

```mermaid
graph TD
  LoopReq[Stuck In Loop Request] --> Skill[zoom-out SKILL]
  SameErr[Same Error Keeps Failing] --> Skill
  Rethink[Rethink Assumptions Request] --> Skill
  ThreeFail[Three Same Signature Failures] --> Breaker[hooks scripts rule-of-3 js]
  Breaker --> Skill
  SingleFail[Routine Single Failure] --> DirectFix[Fix Directly]
  Greenfield[Greenfield Planning No Failures] --> Fable[fable-mode SKILL]
  Skill --> ReportGate[Valid Report RESUME or ESCALATE]
```

## 3. Real-World Use Case

```mermaid
graph TD
  Fail[Same Test Fails Three Times Same Signature] --> Halt[Stop Edits Rebuild Picture ReadOnly]
  Halt --> Inspect[Restate Goal Check Files Config Logs]
  Inspect --> Write[Fill templates zoom-out-report template md]
  Write --> Choice{Untried Path Exists?}
  Choice -->|yes| Resume2[RESUME On Untried Path]
  Choice -->|no| Esc2[ESCALATE With Options]
  Resume2 -->|repeated cycle| Reset2[npm run harness reset Then self-evolve]
```

Template: `zoom-out/templates/zoom-out-report.template.md`. Enforcement: `hooks/scripts/rule-of-3.js`. Deep dive: `zoom-out/references/circuit-breaker.md`.

## 4. Verification Check

- [ ] After three same-signature failures, edits stopped and the same approach was not retried
- [ ] Goal, files, configuration, and logs were rechecked with read-only tools before any resume
- [ ] `templates/zoom-out-report.template.md` was filled and the session `zoom-out-report.md` ends in `RESUME` or `ESCALATE`
- [ ] Resume targeted only an untried path; genuine user decisions were escalated with options
- [ ] Reset via `npm run harness:reset` happened only after the second cycle, with the insight recorded via `self-evolve`
- [ ] Routine single-failure debugging and greenfield planning without failures were not routed here
