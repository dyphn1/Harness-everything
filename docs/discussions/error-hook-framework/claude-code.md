# Claude Code — Error Hook timing and reviewer-gated treatment (owner-aligned draft)

> **#439 Claude Code architecture/timing: CLOSED FOR DISCUSSION; host/runtime behavior: NOT YET VERIFIED.** This is a draft artifact, **not** code, configuration, an approved rollout, a passing real-host test or a permission bypass. Based on [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks), checked 2026-11-13. The overall [#439](https://github.com/dyphn1/Harness-everything/issues/439) body is authoritative for owner decisions; runtime changes are under [#394](https://github.com/dyphn1/Harness-everything/issues/394).

## Design closure: who decides what

**Do not make the player also the referee.** An Error Hook is an observer and bounded context carrier. After a problem is observed, the Main Agent **captures facts in Level 1 A**, then delegates **independent verification in B Triage** to a Reviewer Subagent when needed. A confirmed finding continues the same Level 1 Occurrence at **C Identify**. The Reviewer, not the Main Agent (nor Hook), judges whether the suspected error is real; the Main Agent owns Workflow decisions inside Level 1. This does not authorize every tool error to spawn a Reviewer automatically.

- **Hook**: sees an officially supported event/payload, identifies relevance conservatively, optionally returns a *suspicion/evidence cue*; no automated verdict, correction, escalation, repeat counter or subagent dispatch.
- **Main Agent**: detects a potential problem from evidence (including its own reasoning), asks independent Reviewer to establish a finding, and handles confirmed problems within existing L1.
- **Reviewer Subagent**: fresh, bounded, preferably read-only verification; inspect evidence and counterexamples; produce `Confirmed`, `Not confirmed` or `Inconclusive` with rationale. A reviewer cannot be a copy of the Main Agent's diagnosis; initial instructions should avoid asserting the suspicion as fact.
- **Level 1**: Capture → Triage → Identify → Decide disposition → Treat → Deliver → Accept/retire. **Level 2** is the relevant Action diagram; **Level 3** is Skill/Script/CLI only when needed. Existing ledger/registry are the authority.
- **Evidence gate**: repair **and** workaround outputs require independent verification; failing, missing or contradictory evidence is never reported as success. Verification/correction inside Level 2 Treat does **not** restart Level 1; unresolved treatment proceeds to F Deliver and G Accept with an open outcome.

```mermaid
flowchart TD
  RUN["Main Agent executes Workflow"] --> SUS{"Problem observed or suspected?"}
  SUS -->|No| RUN
  SUS -->|Yes| A["A · Capture<br/>Main Agent preserves raw Evidence; no verdict"]
  HOOK["Claude Code Hook<br/>Evidence / relevant context only"] -. "Observation, not adjudication" .-> SUS
  A --> B["B · Triage"]
  B --> APPROVED{"Already-approved Tolerate class?"}
  APPROVED -->|Yes| FAST["Bounded operation-local retry<br/>resume if recovered; otherwise UNVERIFIED"]
  APPROVED -->|No| RV["Main Agent dispatches isolated Reviewer<br/>during Triage: hypothesis + Evidence"]
  RV --> FIND{"Reviewer finding"}
  FIND -->|Not confirmed| DISMISS["Dismiss with reason / resume Workflow"]
  FIND -->|Inconclusive| HOLD["Hold; collect Evidence / Owner decision"]
  FIND -->|Confirmed| C["C · Identify<br/>Error Class and this Occurrence"]
  C --> IDENT{"Identification complete?"}
  IDENT -->|No| HOLD
  IDENT -->|Yes| BLOCK{"Blocks main Workflow?"}
  BLOCK -->|No| DEFER["Record and defer treatment"]
  BLOCK -->|Yes| D["D · Decide disposition"]
  D --> POSS{"Allowed treatment feasible?"}
  POSS -->|Converge| REPAIR["Repair affected area"]
  POSS -->|Avoid| REPLAN["Scoped Workflow replan<br/>preserve task obligations"]
  POSS -->|Approved Tolerate| TREAT_T["Apply approved bounded treatment"]
  POSS -->|No valid path| UNRES["Unresolved + Evidence"]
  REPAIR --> E["E · Treat (same Occurrence)"]
  REPLAN --> E
  TREAT_T --> E
  E --> LOCAL["Level 2 local correction and verification"]
  LOCAL --> CHECK{"Treatment outcome?"}
  CHECK -->|Correctable within Action and budget| LOCAL
  CHECK -->|Complete or unresolvable| F["F · Deliver outcome / relevant context"]
  F --> G["G · Accept and retire"]
  G --> OUT{"Acceptance"}
  OUT -->|Verified Converge / Avoid| RETURN["Accept and return to Workflow"]
  OUT -->|Approved Tolerate| KEEP["Keep Tolerate active; not rooted out"]
  OUT -->|Unverified / unmet| UNRES
```

**Do not confuse `Avoid` with simply skipping verification.** For an irreparable failing operation, adjust **only the affected Workflow segment** and preserve original goals, dependencies, previously accepted outputs and mandatory checks. If no valid alternative exists, leave it `Unresolved`. Under [#437](https://github.com/dyphn1/Harness-everything/issues/437), `Converge` / `Avoid` / approved `Tolerate` are distinct dispositions; approved bounded retries for a tolerate class are **not** permission to reinstate legacy Rule-of-3 lock/counter/automatic reflection.

## Host event points — documented versus selected

```mermaid
sequenceDiagram
    autonumber
    participant W as Workflow / user task
    participant H as Claude Code hooks
    participant M as Main Agent
    participant T as Tool batch
    participant R as Independent Reviewer subagent
    W->>H: SessionStart / UserPromptSubmit where relevant
    H-->>M: Minimal relevant context (not verdict)
    M->>T: Chosen tool calls
    opt PreToolUse: tool already selected
      H->>H: Observe requested tool and args
    end
    T-->>H: PostToolUse / PostToolUseFailure
    H-->>M: Evidence and optional PostToolBatch bounded cue
    M->>M: Problem observed -> Level 1 A Capture facts
    M->>M: Level 1 B Triage (approved Tolerate route if applicable)
    opt Main Agent needs independent adjudication
      M->>R: Dispatch Reviewer during Triage with hypothesis and Evidence
      H-->>R: SubagentStart: relevant issues, not prior verdict
      R-->>M: Confirmed / Not confirmed / Inconclusive
    end
    opt Reviewer confirmed; blocking and identified
      M->>M: C Identify → D Decide disposition
      M->>M: E Treat: Converge or scoped Avoid / approved Tolerate
      Note over M: Level 2 correction/check stays inside Treat; no L1 restart
      M->>M: F Deliver → G Accept / retire or Unresolved
    end
```

| Event | Official relative timing | #439 role | Decision |
| --- | --- | --- | --- |
| `UserPromptSubmit` | Prompt submission before model processing | Small, already-relevant initial Action/Reviewer cue | **Core context entry** where evidence is available |
| `SessionStart` | New/resumed/compacted session context | Restore necessary current Action references; never flood all lessons | **Optional continuity** |
| `PreToolUse` | After tool selected, before execution | May observe planned operation; cue may arrive too late to change that tool choice | **Not primary** prevention/injection point |
| `PostToolUseFailure` | A tool call fails | Precise failure input/evidence to invite independent verification | **Core observation** |
| `PostToolUse` | Successful tool execution | Detect only objectively checkable anomalies in returned data; semantic doubt remains Main Agent / Reviewer work | **Conditional observation** |
| `PostToolBatch` | Once after **all tools in the batch resolve**, before next model request | Optionally coalesce multiple outcomes into one bounded context hint | **Core coalescing candidate**; no compulsory duplicate injection |
| `SubagentStart` | Reviewer/other child starts | Task-specific evidence, scope, and verification criteria; avoid confirmation bias | **Reviewer continuity** |
| `Stop` | Agent about to finish response | Can observe termination, but too late for primary detection/replanning | **Not primary** |

### Host constraints and unresolved behavior

1. **Hook timing is not model receipt**. Capture independently: hook invoked → matching cue generated → context accepted → Main Agent/Reviewer actually received it → Reviewer finding → treatment → verified result. Do not report an implementation PASS solely from hook stdout.
2. **Batch versus per-call**. `PostToolUseFailure` provides explicit per-tool failure data; `PostToolBatch` receives the batch in a **different** result representation. A single batch context may avoid repetitive hints, but do not assume both payloads are interchangeable or introduce a duplicate cross-event store. Prefer deterministic extraction from the event currently observed; proof of exact fields is part of host tests.
3. **No hook-controlled reviewer**. A failed tool does **not** automatically mean an error class is confirmed, or demand an immediate Reviewer. Reviewer is dispatched by the Main Agent once it suspects an actual problem. Non-tool reasoning errors may not have a corresponding native failure event.
4. **Reviewer isolation**. `SubagentStart` can inject child-scoped additional context, but *technical transport* is not proof of independent reasoning. Child input should contain falsifiable claims/evidence, not pre-committed verdicts.
5. **Scope and incidence**. Repair attempts and alternate-route validation remain in the current treatment while they address the same occurrence; a later independent failure/recurrence starts a new occurrence, reusing existing class/history as relevant.
6. **Fail-open applies to contextual delivery**. A disabled/unreadable hook does not produce a false approval for required checks or authorization; underlying verification and permissions remain intact. Avoid legacy `rule-of-3.js` and `rule-of-3-tracker.js` logic, whose retirement is owned by #394.
7. **No live-host claim**. Registration, supported version, actual payload, `PostToolBatch` interaction with per-tool failure events, batch deduplication, resumed session and subagent context receipt are *untested*. Validate later in #394; do not reopen the conceptual timing decision merely because testing remains.

## Minimum scoped host validation (later, owned by #394)

| Probe | Expected observation |
| --- | --- |
| One failing tool | Native failure event observed; Main Agent receives only bounded suspicion evidence; Reviewer makes the truth judgement |
| Two parallel calls, one failure | Batch fires once at supported boundary; no duplicated lesson spam; distinguish failure payload from batch payload |
| Tool succeeds but violates a machine-checkable invariant | Conditional observation only; Reviewer confirms or rejects with evidence |
| Review finding with no failed tool | Main Agent can initiate Reviewer/Error Handling without relying on `PostToolUseFailure` |
| Rejected or inconclusive suspicion | No fabricated confirmed error / PASS |
| Irreparable operation with valid alternate route | Only affected Workflow segment changes; independent review verifies maintained obligations |
| No viable workaround or missing proof | Unresolved and explicit report; never silently skip mandatory checks |
| Reviewer subagent / resume / compact | Evidence travels to the right child/turn, without cloning Main Agent conclusions |

### Disposition / links

- **Claude Code lifecycle point selection: discussion closed.** No need to invent additional Host hook timings.
- **Implementation status: UNVERIFIED**; any adapter, Hook JSON, routing/ledger lookup and removal of obsolete behavior belong to [#394](https://github.com/dyphn1/Harness-everything/issues/394).
- This document is a **branch draft**. Codex and OpenCode V1/V2 timing remain separately open in [#439](https://github.com/dyphn1/Harness-everything/issues/439).
- Official: [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks), including `PostToolUseFailure`, `PostToolBatch`, and `SubagentStart`.
