# Error Hook Framework — three-host architecture draft

> **Discussion draft for [#439](https://github.com/dyphn1/Harness-everything/issues/439), not an implementation or an approved host capability claim.** This branch is **independent of #437** (based on `main`) to avoid coupling its document changes to the ongoing E-0002 diagram revisions. Read the [E-0002 Level 2 Action Map on its discussion branch](https://github.com/dyphn1/Harness-everything/blob/discussion/437-e0002-capture-level2/docs/discussions/error-handling/actions/e0002-action-map.md) when the behavior example is relevant.

## Owner-accepted Claude Code closure (2026-11-13)

**[Claude Code event timing, self-correction, optional Reviewer investigation and scoped Avoid/workaround and unresolved reporting](./claude-code.md)** is the authoritative Claude-specific draft for this discussion branch. **In Coordinator mode Main must dispatch read-only Reviewer investigation and independent outcome verification; Solo executing Main may self-correct without independent review. Both reuse the same L1 Action semantics and prior Context.** Hook supplies bounded evidence/context, not a verdict. Main Agent can fix the affected Workflow segment, or when direct repair is infeasible, **replan only the affected segment using a valid workaround**, preserving the task's mandatory checks. If neither works or proof is missing, explicitly report **Unresolved**. Acceptance requires objective Evidence. Coordinator Main dispatches read-only independent verification before accepting; Solo Main must disclose no independent review. Claude native timing design is **closed**; host adapter delivery and behavioral validation remain **unchecked** under #394. Codex now has its own owner-adjudicated [evidence/reviewer-index draft](./codex.md). OpenCode **V2-only** has a [timing/context draft](./opencode-v2.md); new V1 feature work is excluded.

## Owner-adjudicated Codex CLI evidence / Reviewer context (2026-11-13)

**[Codex diagram and responsibilities](./codex.md)** extends the Claude closure: `PostToolUse` contributes **Evidence only**, never an Error verdict or compulsory reviewer dispatch; `SubagentStart` injects **Reviewer instructions, case evidence and a relevant historical problem/Error Class index** (IDs, titles, short symptom/constraint and reference). Do **not** preload full resolutions or deep Action/Skill detail — Reviewer opens those only when needed. A small amount of orientation context is intentional to reduce repeated mistakes; independent Reviewer findings still decide whether the *current* suspected problem is real. Direct repair / scoped Workflow workaround / Unresolved remain in L1. The official `SubagentStart` event does **not** itself supply the review packet or problem ID: correlation and actual child receipt are unresolved Host/implementation checks under #394, not proven capabilities.

## Codex routing refinement / System One future option (2026-11-13)

[Codex owner-aligned draft](./codex.md) now distinguishes **stable mechanism switch → native Reviewer role → scoped dispatch packet/evidence → deterministic related-issue summaries**. Process-child environment inheritance is documented as an **optional limited fallback**, not a native-subagent guarantee. Long term, optional **System One feature scoring** may rank context candidates / abstain, using dispatch features while leaving independent Reviewer truth assessment, Kernel rules and Level 1 untouched. This **does not gate** implementation of the current Host Hook contract; no System One integration is claimed.

## OpenCode V2-only error-hook draft (2026-11-13)

**[OpenCode V2 diagrams, timing and verification plan](./opencode-v2.md).** Official `ctx.tool.hook("execute.after")` is the **Evidence-only** observer; `ctx.session.hook("context")` contributes task/role-scoped Reviewer instructions, case references and a **small related issue list** before **each relevant Agent model request** (including continuations). Historical entries are candidate checks, not a verdict. **Critical nuance:** edits to `event.system` are **request-scoped**. Do **not** omit necessary context merely because the same cue was injected on an earlier request. Avoid duplicate content *within the current request* and full history loading; optional keyed `session.instructions.entry` updates are a **separate, unverified optimization**. New OpenCode V1 Hook feature development/acceptance is out of scope (critical-fixes-only maintenance); preserve legacy compatibility notes without imposing a V1 gate. Coordinator-required independent Reviewer investigation and Solo Main self-correction use the **same Level 1/2/3**, with prior Action context passed to Reviewer; Converge / scoped Avoid / Unresolved remain available. Host child dispatch correlation and model-visible receipt remain UNVERIFIED under #394.

## Ownership and architectural fit

- [#403](https://github.com/dyphn1/Harness-everything/issues/403): long-term Graph Engineering, hierarchy/funnel, progressive disclosure, cost-aware modularity.
- [#402](https://github.com/dyphn1/Harness-everything/issues/402): Error Handling lifecycle, agent-directed treatment and decisions.
- [#437](https://github.com/dyphn1/Harness-everything/issues/437): Level 1 overall process, Level 2 magnified behavior blocks, Level 3 on-demand Skill/Script/reference.
- [#394](https://github.com/dyphn1/Harness-everything/issues/394): **owns actual Hook / Error Ledger lesson injection, removal of superseded Rule-of-3 enforcement, and three-host verification**. This document must not replace that scope or become a second hook controller.
- [#359](https://github.com/dyphn1/Harness-everything/issues/359): existing Error Ledger is the record authority; no second memory store.

**Goal:** At the point a model makes a relevant decision, it receives a **small, usable** Error Handling Action cue and, only when needed, the Skill/CLI entry to perform it. **A Hook delivers context, not decisions, permission or the execution of Error Handling itself.** In Coordinator mode Main must dispatch independent read-only Reviewer investigation and acceptance checks; when Main executes alone, it may self-correct using objective Evidence. The Reviewer inherits prior context and the execution owner retains changes/Action responsibility, including scoped Avoid/workaround if direct repair is infeasible. A script is responsible for only its deterministic contract and return codes.

## One Level 1 workflow — Coordinator mandatory review / Solo self-correction

**A–G are the same #437 Error Handling Actions regardless of actor.** When Main is a **Coordinator** supervising delegated execution, it **must dispatch a read-only Reviewer** for error investigation and **again arrange independent read-only verification at G Accept**. If Main is the **sole executing Agent**, it may self-correct using model-visible Hook Evidence and the same L1/L2/L3; objective checks remain required and no independent-review claim is made. Reviewer inherits **previous Action progress and scoped Evidence**, independently rechecks claims in the *same* L1 semantics, and returns findings without editing source. Its dispatch does **not** create a second Error Occurrence or a new L1 Activity.

\`\`\`mermaid
flowchart TD
  H["Host Hook: objective Evidence + relevant reminders only"] -. "Delivered when host supports it" .-> O
  O["Executing Agent observes an error or suspicious result"] --> A["L1 A · Capture: preserve raw Evidence"]
  A --> B["L1 B · Triage"]
  B --> T{"Previously approved Tolerate class?"}
  T -->|Yes| RETRY["Bounded operation retry / UNVERIFIED if unresolved"]
  T -->|No| PATH{"Handling situation?"}
  PATH -->|Agent recognizes its error| SELF["Self-correction: same L1 Actions"]
  PATH -->|Main seeks independent investigation| DPK["Dispatch Reviewer with A/B progress,<br/>hypothesis, Evidence and related issues"]
  DPK --> R["Reviewer: SAME L1 semantics,<br/>independently recheck relevant earlier facts"]
  R --> V{"Independent finding"}
  V -->|Not confirmed| DIS["Dismiss suspected problem with reason"]
  V -->|Inconclusive| HOLD["Hold / more evidence / Owner"]
  V -->|Confirmed| BACK["Return finding and updated Action context"]
  SELF --> C["L1 C · Identify"]
  BACK --> C
  C --> GATE{"Identified, blocking current Workflow?"}
  GATE -->|No, nonblocking| DEFER["Record / Defer"]
  GATE -->|Unidentified| HOLD
  GATE -->|Yes| D["L1 D · Decide disposition"]
  D --> E["L1 E · Treat: Converge / scoped Avoid / approved Tolerate"]
  E --> LOCAL["Level 2: bounded local correction and objective check"]
  LOCAL --> OUT{"Treatment outcome"}
  OUT -->|Correctable locally| LOCAL
  OUT -->|Done / cannot converge| F["L1 F · Deliver evidence and relevant context"]
  F --> G["L1 G · Accept / retire or Unresolved"]
\`\`\`

**The arrow from B to a Reviewer is **mandatory in Coordinator mode** and not used in Solo mode; this role-specific check is part of the existing B Triage, **not** a new L1 Action.** Raw Evidence and prior Action progress travel as **review inputs, not pre-established conclusions**. On returning, the responsible Agent continues from the applicable Action and does not blindly re-run A/B. A later independent failure/recurrence starts a **new** Occurrence at A; iteration inside current Treat is local to L2 and subject to the existing budget. Acceptance follows the applicable objective checks; **self-correction is not proof of independent review**, and a required independent review must never be fabricated.

**Level 1 authority:** [#437's current Activity Diagram draft](https://github.com/dyphn1/Harness-everything/blob/discussion/437-e0002-capture-level2/docs/discussions/error-handling/README.md). This document is a Hook-facing **participation view**, not a second definition of Action sequence or approval policy. #437's older issue-body diagram may show superseded recurrence arrows. **The exact requirement for Reviewer in the L1 \`Real problem?\` guard remains an explicit owner clarification**, listed in the [semantic audit](./semantics-review-2026-11-13.md); do not silently rewrite #437 here.

## Common logical design — one selector, distinct host transports

```mermaid
flowchart TD
  H["Host Hook: objective Evidence + related reminders"] -. "Context only" .-> O
  O["Execution error observed"] --> A["L1 A · Capture: raw Evidence and active Workflow state"]
  A --> B["L1 B · Triage"]
  B --> MODE{"Main Agent role?"}
  MODE -->|Coordinator| R["Main dispatches independent read-only Reviewer<br/>A/B progress + Evidence + hypothesis + issue index"]
  MODE -->|Solo executor| S["Main checks objective Evidence<br/>self-correction when no Reviewer is available"]
  R --> FIND{"Reviewer finding"}
  FIND -->|Not confirmed| DIS["Dismiss with reason"]
  FIND -->|Inconclusive| HOLD["Hold / Owner / gather Evidence"]
  FIND -->|Confirmed| T{"Approved Tolerate class?"}
  S --> T
  T -->|Yes| FAST["Bounded operation retry / UNVERIFIED if unresolved"]
  T -->|No| C["L1 C · Identify"]
  C --> BL{"Identified + blocking?"}
  BL -->|Nonblocking| DEF["Record / Defer"]
  BL -->|Unknown| HOLD
  BL -->|Yes| D["L1 D · Decide: Converge / Avoid / approved Tolerate"]
  D --> E["L1 E · Treat + L2 local correction/check"]
  E --> F["L1 F · Deliver"]
  F --> G["L1 G · Accept"]
  G --> A_MODE{"Main Agent role?"}
  A_MODE -->|Coordinator| VERIFY["Main dispatches independent read-only Reviewer<br/>verify fix/workaround and preserved obligations"]
  A_MODE -->|Solo executor| MECH["Main checks objective Script/CI/contract results<br/>no independent review claim"]
  VERIFY --> COND{"Acceptance evidence sufficient?"}
  MECH --> COND
  COND -->|Yes| OK["Accept / retire applicable lesson"]
  COND -->|No| U["Keep UNVERIFIED / Unresolved"]
```

**This diagram is an architecture relationship, not a timing promise.** The same tool event can be **too late to change a tool already chosen**; only receipt at a *model-decision boundary* can steer that decision. Transport, invocation, actual injection, model receipt and subsequent behavior must be measured separately.

## The temporal trap — interception is not prior model knowledge

```mermaid
sequenceDiagram
    autonumber
    participant W as Workflow / task
    participant H as Host hook
    participant R as Shared selector / Ledger / Registry
    participant M as Agent model
    participant T as Tool / Script
    W->>H: Prompt or model-context boundary
    H->>R: Relevance query (bounded)
    alt Matching lesson/Action
      R-->>H: Small cue + optional Skill reference
      H-->>M: Host-supported model-visible context
    else No match / unavailable
      R-->>H: No cue; fail-open
    end
    M->>T: Select tool and invoke operation
    opt PreToolUse (already selected tool)
      H->>R: Inspect planned tool/args
      Note over H,M: An added cue may reach a later model turn;<br/>do not assume the pending tool will be replanned
    end
    T-->>H: Completed tool result / error
    H->>R: Match failure class, if available
    H-->>M: Failure lesson at a supported next model point
    M->>W: Continue current Action, or disclose unresolved
```

Therefore the **preferred prevention opportunity** for E-0002 is the model-context boundary **before report-writing selection** (when available). Tool/failure hooks are valuable **observers and later corrections**, not a replacement for this early cue. Host access differs and cannot be flattened into a single assumed hook event.

## Host-specific transport and guarantees

See **[the three-host detailed Hook diagrams and matrix](./hosts.md)**. Keep these host details out of the shared policy:

| Host | Early relevance disclosure candidate | Failure observation candidate | Explicit limitation |
| --- | --- | --- | --- |
| Claude Code | `UserPromptSubmit` / `SessionStart` where relevant; `SubagentStart` for Reviewer context | `PostToolUseFailure`, conditional `PostToolUse`; `PostToolBatch` once per batch before next model request | **[Claude closure](./claude-code.md):** Hook is cue only, Reviewer judges truth; direct repair or scoped workaround; no live-host receipt yet |
| Codex CLI | `UserPromptSubmit` / `SessionStart` for entry; `SubagentStart` for Reviewer task + **related issue summaries** | `PostToolUse` **Evidence only** (including nonzero, no verdict) | **[Codex closure](./codex.md):** Review task correlation not native to `SubagentStart`; `PreModelRequest` diagnostic-only; real host receipt unchecked |
| OpenCode V2 only | `ctx.session.hook("context")` before each relevant Agent model request; child task scope must be verified | `ctx.tool.hook("execute.after")` **Evidence only** | **[V2 draft](./opencode-v2.md):** request-scoped Context, per-request dedup, related issue summaries; V1 maintenance-only/no new feature gate |

**Do not equate** official Host API support, code configured, packaging tests, real Host hook invocation, model-visible receipt or behavioral improvement. Retain separate status for each.

## E-0002 vertical slice — minimum useful behavior

```mermaid
flowchart LR
    MARK["Report-required active step<br/>or explicit report-status:E-0002 signal"] --> H["Host adapter at model-context boundary"]
    H --> L["Read relevant entry / lookup<br/>provide Action cue, not entire Ledger"]
    L --> M["Agent: choose truthful body + status"]
    M --> S["Proposed Report Script<br/>codex -o raw input → final report<br/>write/check terminal STATUS"]
    S --> RC{"Return code / structural check"}
    RC -->|0| OK["Report structure verified<br/>substantive task acceptance checked separately"]
    RC -->|nonzero| RET["Agent handles errors within active Action<br/>or records unresolved, no false PASS"]
```

The Report Writer interface is **still a proposal** in [#437's Level 3 draft](https://github.com/dyphn1/Harness-everything/blob/discussion/437-e0002-capture-level2/docs/discussions/error-handling/details/e0002-report-writer.md). The existing [ROUTE-001 ADR](../../adr/ROUTE-001-error-lesson-delivery.md) describes the `UserPromptSubmit` explicit marker proposal, but it is **not an installed lesson-injection mechanism**. Do not promote this logical path to deployed/verified.

## Failure policy and constraints

- **Selective, deterministic, bounded and fail-open** as **advisory context injection**. Silence for unrelated operations; no context flood, duplicate-lesson spam, second ledger or global always-on learning.
- **No count/threshold, forced Zoom-out, token, mutation lock, mandatory reflection report or automatic escalation.** This does not relax pre-existing *user/host permission checks*, and deterministic Script/CLI checks may legitimately return a nonzero exit.
- **Unknown/absent Workflow state:** an explicit agreed marker can serve as a first-slice relevance input when present; lack of evidence is not grounds to fabricate E-0002 classification or to load every ledger entry.
- **Subagents, compaction, resume, background tasks and tool result shape** are Host/Version-sensitive. Do not assume initial context propagates automatically; test the required actor and model request.
- **Progressive disclosure:** first a short instruction about the current Action; Level 3 command details only if required and available. Relevance should not be inferred from a generic code edit alone.
- **Evidence:** hook fired ≠ injected output ≠ model-visible receipt ≠ Agent action ≠ Script check ≠ fewer recurrences. Keep each distinction explicit.

## Implementation/evaluation boundary

This is a **conceptual draft**. [#394](https://github.com/dyphn1/Harness-everything/issues/394) remains the owner of any real code/Hook work. Do not add new Host adapters, monkeypatch model contexts or remove old policies from this discussion branch. Define one E-0002 end-to-end slice and verify **the actual model receipt and Action use** separately on Claude, Codex and OpenCode before calling the mechanism integrated. Compare recurrence/total cost **only after** Error Handling + Hook + Script + Ledger/Skill delivery work as a system.

**Next design question:** choose which evidence-backed model-decision event each Host can use for **pre-action** Action disclosure, and which Host-specific event surfaces should be reserved for **post-failure** observations. Do not add a new universal hook event abstraction until the three concrete mappings are understood.
