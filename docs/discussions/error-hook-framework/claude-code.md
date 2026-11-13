# Claude Code — Error Hook timing, Coordinator-required read-only review and Solo correction

> **#439 Claude Code architecture/timing: CLOSED FOR DISCUSSION; host/runtime behavior: NOT YET VERIFIED.** This is a draft artifact, **not** code, configuration, an approved rollout, a passing real-host test or a permission bypass. Based on [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks), checked 2026-11-13. The overall [#439](https://github.com/dyphn1/Harness-everything/issues/439) body is authoritative for owner decisions; runtime changes are under [#394](https://github.com/dyphn1/Harness-everything/issues/394).

## Design closure: who decides what

**One Level 1/2/3 with mode-dependent authority.** In **Coordinator mode**, Main **must dispatch an independent read-only Reviewer** for observed error investigation and for G Accept outcome verification. The child receives prior Action state, raw Evidence, hypothesis and relevant historical issue summaries; it independently checks the case but never writes fixes by default. In **Solo Main execution mode**, Main may self-correct with Hook reminders and objective Script/CI/contract evidence, without claiming an independent review. Reviewer is not an extra workflow or a new Occurrence; a trivial error is not an automatic write-permission exception.

- **Hook**: sees an officially supported event/payload, identifies relevance conservatively, optionally returns a *suspicion/evidence cue*; no automated verdict, correction, escalation, repeat counter or subagent dispatch.
- **Main Agent**: if **Coordinator**, dispatches read-only Reviewer for investigation and independent post-treatment verification, and retains acceptance authority. If **Solo**, self-corrects using objective evidence and reports lack of independent review.
- **Reviewer Subagent**: **read-only by default**, independently investigates and checks outcome in the same Level 1 flow using prior Action context; rechecks evidence and counterexamples; produces `Confirmed`, `Not confirmed` or `Inconclusive` with rationale. A reviewer cannot be a copy of the Main Agent's diagnosis; initial instructions should avoid asserting the suspicion as fact. No correction privilege is granted for tiny/trivial errors; any future class-scoped exception needs explicit separate owner approval, not a host-specific permission created by a Hook.
- **Level 1**: Capture → Triage → Identify → Decide disposition → Treat → Deliver → Accept/retire. **Level 2** is the relevant Action diagram; **Level 3** is Skill/Script/CLI only when needed. Existing ledger/registry are the authority.
- **Acceptance evidence**: repair **and** workaround outputs must meet the applicable objective/contract checks. Self-correction is **not** an independent Reviewer finding. In Coordinator mode, independent Reviewer investigation and acceptance verification are **required**. In Solo mode objective checks remain required, but no independent review is claimed. Missing/contradictory proof is not a PASS. Verification/correction inside Level 2 Treat does **not** restart Level 1; unresolved treatment proceeds to F Deliver and G Accept with an open outcome.

```mermaid
flowchart TD
  X["Executing Agent runs Workflow"] --> OBS{"Observed error or Hook Evidence?"}
  H["Claude Code Hook<br/>bounded Evidence + related issue cue"] -. "No verdict or dispatch" .-> OBS
  OBS -->|No| X
  OBS -->|Yes| A["L1 A · Capture original Evidence"]
  A --> B["L1 B · Triage"]
  B --> MODE{"Main Agent mode?"}
  MODE -->|Coordinator| REV["Main dispatches independent read-only Reviewer<br/>prior Action context + Evidence"]
  MODE -->|Solo Main executes work| SELF["Main checks objective Evidence<br/>and may self-correct"]
  REV --> FIND{"Reviewer finding"}
  FIND -->|Not confirmed| DIS["Dismiss"]
  FIND -->|Inconclusive| HOLD["Hold / Owner / evidence"]
  FIND -->|Confirmed| T{"Approved Tolerate?"}
  SELF --> T
  T -->|Yes| FAST["Bounded retry / UNVERIFIED if unresolved"]
  T -->|No| C["L1 C · Identify"]
  C --> BLOCK{"Identified and blocking?"}
  BLOCK -->|Nonblocking| DEFER["Record / Defer"]
  BLOCK -->|Unidentified| HOLD
  BLOCK -->|Yes| D["L1 D · Decide"]
  D --> E["L1 E · Treat: Converge / scoped Avoid / approved Tolerate"]
  E --> LOCAL["L2 local correction and checks"]
  LOCAL --> DONE{"Treat finished or cannot converge?"}
  DONE -->|No, correctable| LOCAL
  DONE -->|Yes| F["L1 F · Deliver"]
  F --> G["L1 G · Accept"]
  G --> ACCEPT_MODE{"Main mode?"}
  ACCEPT_MODE -->|Coordinator| R2["Main dispatches read-only independent Reviewer<br/>verify outcome / obligations"]
  ACCEPT_MODE -->|Solo Main| C2["Check objective Script / CI / contract Evidence<br/>no independent review claim"]
  R2 --> RESULT{"Acceptance conditions met?"}
  C2 --> RESULT
  RESULT -->|Yes| OK["Accept / retire if appropriate"]
  RESULT -->|No or no proof| UNR["Keep open / Unresolved"]
```

**Do not confuse `Avoid` with simply skipping verification.** For an irreparable failing operation, adjust **only the affected Workflow segment** and preserve original goals, dependencies, previously accepted outputs and mandatory checks. If no valid alternative exists, leave it `Unresolved`. Under [#437](https://github.com/dyphn1/Harness-everything/issues/437), `Converge` / `Avoid` / approved `Tolerate` are distinct dispositions; approved bounded retries for a tolerate class are **not** permission to reinstate legacy Rule-of-3 lock/counter/automatic reflection.

## Host event points — documented versus selected

```mermaid
sequenceDiagram
  autonumber
  participant X as Executing Agent
  participant H as Claude Code Hook
  participant M as Main Coordinator (if delegated)
  participant T as Tool / Script
  participant R as Read-only Reviewer
  X->>T: Execute Workflow tool
  T-->>H: PostToolUse or PostToolUseFailure
  H-->>X: Objective Evidence / bounded context (PostToolBatch if applicable)
  X->>X: Observe problem → L1 A Capture → B Triage
  alt Main operates as Coordinator
    X-->>M: A/B state and original Evidence
    M->>R: Dispatch independent investigation and prior Context
    H-->>R: SubagentStart related issue summaries, not verdict
    R-->>M: Confirmed / Not confirmed / Inconclusive + Evidence
    M-->>X: Finding and authorized next treatment
    X->>X: Same L1 C/D/E Treat; L2 local correction/check
    X-->>M: Outcome and objective Evidence
    M->>R: Read-only independent outcome verification for G Accept
    R-->>M: Verified conditions / missing proof
    M->>M: G Accept only if supported; otherwise Unresolved
  else Solo executing Main
    X->>X: Same L1; self-correct and check Script/CI/contract
    Note over X: No independent Reviewer claim; UNVERIFIED if proof missing
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

1. **Hook timing is not model receipt**. Capture separate observations: hook invoked → matching cue generated → context accepted → **executing Agent** actually received it → **Coordinator-required Reviewer dispatch/finding** (Solo Main has no independent review) → treatment → objective result. Do not report an implementation PASS solely from hook stdout.
2. **Batch versus per-call**. `PostToolUseFailure` provides explicit per-tool failure data; `PostToolBatch` receives the batch in a **different** result representation. A single batch context may avoid repetitive hints, but do not assume both payloads are interchangeable or introduce a duplicate cross-event store. Prefer deterministic extraction from the event currently observed; proof of exact fields is part of host tests.
3. **No hook-controlled reviewer**. A failed tool does **not** automatically mean an error class is confirmed, or demand an immediate Reviewer. Coordinator Main **must** dispatch read-only Reviewer for independent investigation and at acceptance; **Solo Main** may self-correct with objective checks. Non-tool reasoning errors may not have a corresponding native failure event.
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
