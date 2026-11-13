# Claude Code — Error Hook timing, self-correction and optional Reviewer handoff

> **#439 Claude Code architecture/timing: CLOSED FOR DISCUSSION; host/runtime behavior: NOT YET VERIFIED.** This is a draft artifact, **not** code, configuration, an approved rollout, a passing real-host test or a permission bypass. Based on [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks), checked 2026-11-13. The overall [#439](https://github.com/dyphn1/Harness-everything/issues/439) body is authoritative for owner decisions; runtime changes are under [#394](https://github.com/dyphn1/Harness-everything/issues/394).

## Design closure: who decides what

**Do not make the player also the referee.** An Error Hook is an observer and bounded context carrier. After an error is observed, the **error-producing Agent** can follow L1 A Capture → B Triage and self-correct within the same L1/L2/L3 flow. When Main requests an independent investigation, the Reviewer enters the **same flow** with existing A/B progress and Evidence, validates the relevant Action independently, and returns findings; Reviewer is not mandatory for every correction. When independently dispatched, the Reviewer judges the suspicious finding from evidence rather than accepting Main's premise. Self-correction by the error-producing Agent remains valid, but is not presented as independent adjudication; the responsible Agent owns Workflow decisions inside Level 1. Reviewer receives previous Action progress rather than restarting the entire flow. Not every tool error requires a Reviewer.

- **Hook**: sees an officially supported event/payload, identifies relevance conservatively, optionally returns a *suspicion/evidence cue*; no automated verdict, correction, escalation, repeat counter or subagent dispatch.
- **Main Agent**: can self-correct its own detected error using existing L1/L2/L3; requests independent Reviewer when a suspicious result warrants separate verification. The execution owner acts on independently verified findings as assigned.
- **Reviewer Subagent**: fresh, bounded independent investigation in the same Level 1 flow using prior Action context; recheck evidence and counterexamples; produce `Confirmed`, `Not confirmed` or `Inconclusive` with rationale. A reviewer cannot be a copy of the Main Agent's diagnosis; initial instructions should avoid asserting the suspicion as fact. **Whether this role may perform explicitly delegated bounded correction beyond findings-only remains an open owner decision**, not a host-specific permission created by a Hook.
- **Level 1**: Capture → Triage → Identify → Decide disposition → Treat → Deliver → Accept/retire. **Level 2** is the relevant Action diagram; **Level 3** is Skill/Script/CLI only when needed. Existing ledger/registry are the authority.
- **Acceptance evidence**: repair **and** workaround outputs must meet the applicable objective/contract checks. Self-correction is **not** an independent Reviewer finding. Where an independent review is required or Main requests one, preserve Reviewer independence. Missing/contradictory proof is not a PASS. Verification/correction inside Level 2 Treat does **not** restart Level 1; unresolved treatment proceeds to F Deliver and G Accept with an open outcome.

```mermaid
flowchart TD
  EXEC["Executing Agent active Workflow"] --> OBS{"Error observed or Hook evidence suggests failure?"}
  HOOK["Claude Code Hook<br/>bounded Evidence and related cue, never verdict"] -.-> OBS
  OBS -->|No| EXEC
  OBS -->|Yes| A["L1 A · Capture<br/>raw facts / Evidence"]
  A --> B["L1 B · Triage"]
  B --> TOL{"Previously approved Tolerate class?"}
  TOL -->|Yes| FAST["Bounded operation-local retry<br/>UNVERIFIED if not recovered"]
  TOL -->|No| WHO{"Handling situation?"}
  WHO -->|Agent recognizes own error| SELF["Self-correction by executing Agent<br/>same L1 / L2 / L3"]
  WHO -->|Main asks for independent investigation| DP["Dispatch Reviewer with previous A/B context,<br/>Evidence, hypothesis, Workflow step, issue summaries"]
  DP --> REV["Reviewer uses SAME Level 1 Actions<br/>resume relevant step and independently recheck facts"]
  REV --> FIND{"Finding"}
  FIND -->|Not confirmed| DIS["Dismiss with rationale"]
  FIND -->|Inconclusive| HOLD["Hold / evidence / Owner"]
  FIND -->|Confirmed| BACK["Finding + updated Action context to executor"]
  BACK --> CONT["Continue current Occurrence"]
  SELF --> CONT
  CONT --> C["L1 C · Identify"]
  C --> BL{"Identified and blocking?"}
  BL -->|Nonblocking| DEF["Record / Defer"]
  BL -->|Unidentified| HOLD
  BL -->|Yes| D["L1 D · Decide"]
  D --> E["L1 E · Treat: Converge / scoped Avoid / approved Tolerate"]
  E --> LOCAL["Level 2 local correction / verification"]
  LOCAL --> RESULT{"Within Action and budget?"}
  RESULT -->|Correctable| LOCAL
  RESULT -->|Done or unresolved| F["L1 F · Deliver"]
  F --> G["L1 G · Accept / retire or Unresolved"]
```

**Do not confuse `Avoid` with simply skipping verification.** For an irreparable failing operation, adjust **only the affected Workflow segment** and preserve original goals, dependencies, previously accepted outputs and mandatory checks. If no valid alternative exists, leave it `Unresolved`. Under [#437](https://github.com/dyphn1/Harness-everything/issues/437), `Converge` / `Avoid` / approved `Tolerate` are distinct dispositions; approved bounded retries for a tolerate class are **not** permission to reinstate legacy Rule-of-3 lock/counter/automatic reflection.

## Host event points — documented versus selected

```mermaid
sequenceDiagram
  autonumber
  participant X as Executing Agent
  participant H as Claude Hook
  participant T as Tool
  participant M as Main Agent (coordinator when different)
  participant R as Reviewer
  H-->>X: Entry context / relevant historical cue if matched
  X->>T: Execute Workflow tool
  T-->>H: PostToolUse / PostToolUseFailure
  H-->>X: Bounded Evidence (PostToolBatch if useful)
  X->>X: Detect error; L1 A Capture → B Triage
  alt Error-producing Agent self-corrects
    X->>X: Same L1 C/D/E and local L2 correction/check
    X->>X: F Deliver → G Accept or Unresolved
  else Main requests independent investigation
    X-->>M: Problem + A/B progress + raw Evidence
    M->>R: Dispatch hypothesis, scope, Action progress and historical issue index
    H-->>R: SubagentStart adds context, never verdict
    R->>R: Resume SAME L1 from relevant Action; independently validate
    R-->>M: Finding and Evidence with prior context updated
    M-->>X: Verified finding / directions within assigned authority
    X->>X: Continue SAME occurrence, use L2 as needed
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

1. **Hook timing is not model receipt**. Capture separate observations: hook invoked → matching cue generated → context accepted → **executing Agent** actually received it → **optional Reviewer dispatch/finding** if requested → treatment → objective result. Do not report an implementation PASS solely from hook stdout.
2. **Batch versus per-call**. `PostToolUseFailure` provides explicit per-tool failure data; `PostToolBatch` receives the batch in a **different** result representation. A single batch context may avoid repetitive hints, but do not assume both payloads are interchangeable or introduce a duplicate cross-event store. Prefer deterministic extraction from the event currently observed; proof of exact fields is part of host tests.
3. **No hook-controlled reviewer**. A failed tool does **not** automatically mean an error class is confirmed, or demand an immediate Reviewer. Main Agent may dispatch Reviewer for independently examining a suspicious result; an executing Agent may self-correct without that dispatch. Non-tool reasoning errors may not have a corresponding native failure event.
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
