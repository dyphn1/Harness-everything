# Workflow: Zoom Out

> Agent-initiated reassessment when evidence contradicts an assumption or reveals an unknown impact boundary. A first failure may be enough; productive work can continue when attempts add evidence or narrow the cause.

Source of truth: `zoom-out/SKILL.md`.

Zoom-out is voluntary. An agent may choose it on the first meaningful signal or an explicit loop/rethink request, and may continue productive iteration when the next check is justified by new evidence. The former `rule-of-3*.js` counter, `reset-circuit-breaker.js`, forced report/unlock path, and OpenCode hard-lock path are retired under [#394](https://github.com/dyphn1/Harness-everything/issues/394). No counter, lock, reflection token, compulsory report, reset, or automatic escalation is part of this procedure. A short fact-check note can help organize reassessment, but no special artifact is required.

## 1. Skill Behavior Workflow

```mermaid
graph TD
  Signal[Evidence contradicts assumptions or exposes unknown impact] --> Choose{Would reassessment help now?}
  Request[Explicit loop/rethink request] --> Reassess[Agent chooses to zoom out]
  Choose -->|yes| Reassess
  Choose -->|not yet| Continue[Continue justified work]
  Productive[Attempt adds evidence or narrows cause] --> Continue
  Reassess --> ReadOnly[Review goal, acceptance, files, configuration, and evidence]
  ReadOnly --> Next[Choose a justified next check]
```

## 2. Triggering and Routing Path

```mermaid
graph TD
  LoopReq[Stuck In Loop Request] --> Skill[zoom-out SKILL]
  SameErr[Same Error Keeps Failing] --> Skill
  Rethink[Rethink Assumptions Request] --> Skill
  Evidence[First meaningful signal or explicit request] --> Skill
  Productive[Productive iteration] --> Continue[Continue with justified next check]
  SingleFail[Routine Single Failure] --> DirectFix[Fix Directly]
  Greenfield[Greenfield Planning No Failures] --> Fable[fable-mode SKILL]
  Skill --> EvidenceReview[Review evidence and choose a justified next check]
```

## 3. Real-World Use Case

```mermaid
graph TD
  Signal2[Evidence changes assumptions or impact boundary] --> Reassess2[Agent reviews goal, acceptance, and evidence]
  Reassess2 --> Next2[Select a justified next check]
  Productive2[Attempts produce evidence or narrow cause] --> Continue2[Continue iteration]
```

Optional note template: `zoom-out/templates/zoom-out-report.template.md`. The former enforcement hook is retired under [#394](https://github.com/dyphn1/Harness-everything/issues/394). The linked [`zoom-out/references/circuit-breaker.md`](../../zoom-out/references/circuit-breaker.md) describes the retired mechanism and is historical reference material.

## 4. Verification Check

- [ ] The agent chose whether reassessment would improve the next step; it may start on the first meaningful signal
- [ ] When reassessing, the goal, acceptance, files, configuration, and evidence were checked before choosing the next step
- [ ] Productive iteration continued when attempts added evidence or narrowed the cause
- [ ] No failure counter, lock, reflection token, compulsory report, reset, or automatic escalation was assumed
