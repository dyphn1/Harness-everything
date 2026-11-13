# Codex CLI — evidence-only tool hook and Reviewer awareness (owner adjudication)

> **#439 / 2026-11-13: the two design choices below are adjudicated; production integration remains UNVERIFIED.** Discussion-only artifact, no change to installed Hooks, Error Ledger, permissions or runtime. [Overall discussion #439](https://github.com/dyphn1/Harness-everything/issues/439) · [Claude Code closure](./claude-code.md) · [#394 implementation owner](https://github.com/dyphn1/Harness-everything/issues/394).

## Finalized routing discussion — current design vs future System One

**Owner agreement (2026-11-13):** Keep the proven/tractable Codex delivery path independent of System One. Separate *switch*, *role*, *task evidence*, and *relevance selection*. Do not implement a new agent controller or turn model predictions into findings.

| Concern | Current intended input / owner | Boundary |
| --- | --- | --- |
| Enable/disable Error Reviewer reminder | Stable environment/config switch, e.g. conceptual `HARNESS_ERROR_REVIEW=1` | **Illustrative option, not installed configuration or mandatory variable name**; read by Hook adapter when available |
| Identify which child is reviewing | Native `SubagentStart.agent_type` + explicitly selected agent profile | Host agent type/profile must be verified in live installation; cannot infer an automatic `error-reviewer` type exists |
| Identify current suspect, task and evidence | Main Agent's **child dispatch packet** and any existing trusted task-scoped reference | Do not mistake global environment variable for task-scoped state; `SubagentStart` does not natively include the dispatch packet |
| Relevant known issues | Deterministic selector reading existing Error Ledger/registry, given reliable scope | Lightweight **ID, title, short description, reference**; not full resolution/Level 2/3 or a verdict |
| Long-term optimization | **System One** feature scoring to recommend ranked context candidates or abstain; kernel/policy/Reviewers retain authority | Not available as an integrated live Host path yet; separate evaluation required under #403/#233 |

```mermaid
flowchart TD
    M["Main Agent active Workflow"] --> SUS["Problem observed or suspected"]
    SUS --> A["Level 1 A · Capture<br/>preserve raw Evidence without verdict"]
    A --> B["Level 1 B · Triage<br/>decide whether independent review is needed"]
    B --> DP["Dispatch Reviewer<br/>role + hypothesis + scoped Evidence + bounded features"]
    DP --> HS["Codex SubagentStart Hook<br/>agent_type + trusted task reference if available"]
    ENV["Optional stable mechanism enable/config switch"] --> HS
    HS --> MATCH{"Relevant reviewer context available?"}
    MATCH -->|No/unknown| STD["Default Reviewer instructions;<br/>no fabricated matches"]
    MATCH -->|Yes| DET["CURRENT: deterministic relevant issue lookup<br/>existing Ledger/registry"]
    DET --> SHORT["Reviewer context: instructions + Evidence<br/>known issue IDs / titles / brief summaries / refs"]
    STD --> R["Independent Reviewer assesses current observation"]
    SHORT --> R
    F["FUTURE ONLY: System One<br/>rank context candidates or abstain"] -. "ranking only; not verdict" .-> DET
    R --> OUT{"Reviewer finding"}
    OUT -->|Not confirmed| DIS["Dismiss / return to Workflow"]
    OUT -->|Inconclusive| HOLD["Hold / evidence / Owner decision"]
    OUT -->|Confirmed| C["Continue Level 1 at C · Identify<br/>then D/E/F/G as applicable"]
```

### Alternative: dispatch-time environment inheritance (NOT recommended as default)

For a **real OS child process**, a parent can pass a child-specific *environment snapshot* to the spawning operation; a single scoped environment override can work without shared global state. In a strictly serialized process, modifying and restoring the parent process environment may also appear workable, **but global mutable environment is race-prone**, especially across concurrent hooks/Reviewers. A shell executed by an already-running Codex Agent cannot retroactively mutate its host's environment.

**Important:** A Codex **native subagent is not guaranteed to be spawned as a separate OS process**. Therefore there is no documented guarantee it inherits a per-dispatch environment override from the Main Agent, and the Hook's environment cannot be assumed to identify the dispatched Reviewer. Treat this as a *narrow compatibility fallback for demonstrably process-spawned workers*, not as general Codex design.

### Future feature-based Context selection (architecture only)

The dispatch may eventually carry a *small typed feature envelope* such as `role`, `intent`, `workflowStep`, `errorCandidates`, `evidenceRefs` and `constraints`. These are **hypotheses / task characteristics, not verified Error Class findings**. At Hook/context time, the host adapter may pass trusted, scoped features to System One; System One scores **which bounded instruction/related-issue summaries are useful**, or abstains. A deterministic selector continues to provide a usable default when System One is not ready, lacks features, times out, or abstains. Never put model-generated advice above Kernel constraints, permissions, or independent Reviewer evidence.

This is a **future cross-host candidate** also relevant to Claude/OpenCode; it does not alter the accepted `PostToolUse = Evidence only` and `SubagentStart = reviewer instructions + related issue summaries` contract, and does **not** delay the #394 Error Hook implementation or claim an operating model integration. The retained local Harness Status/observation loop may provide later evidence for evaluating relevance quality, **not automatic training or policy mutation**. See [#403](https://github.com/dyphn1/Harness-everything/issues/403) and [#233](https://github.com/dyphn1/Harness-everything/issues/233).

## Owner decisions

1. **`PostToolUse` = Evidence only.** Hook does not classify an Error Occurrence, announce a verified Error Class, prescribe correction, dispatch reviewers or modify the completed tool result. Provide only objectively available tool outcome evidence (or no duplicate cue if the original model-visible result is already sufficient). A failed tool is *a suspicion signal*, not proof that an Error Handling issue exists. Main Agent retains the raw evidence at **A Capture** before reviewer adjudication during **B Triage**.
2. **`SubagentStart` = reviewer instructions AND relevant historical error index.** At the Reviewer entry, supply task/verification scope, the suspected claim and available evidence, and **a readable summary/list of related known error classes/problems** (IDs, names, one-line symptom/constraint, reference). Do not front-load complete issue bodies, prior solution steps, previous verdicts, full ledger entries or Level 2/3. The incremental tokens spent on useful orientation are preferable to a nearly empty pointer. Reviewer can open full references **on demand**.
3. **Reviewer remains independent.** The historical issue list is a *candidate check list*, not a conclusion. Reviewer must evaluate the new evidence and counterexamples independently; `Confirmed`, `Not confirmed`, and `Inconclusive` are reviewer findings, not Hook decisions. Main Agent continues the same Level 1 activity at C Identify after a confirmed finding.
4. **Recovery includes Avoid.** Attempt to converge where feasible; when direct resolution is not viable, replan **only the affected Workflow segment** using a valid workaround/avoidance while preserving original requirements and mandatory checks, then independently verify. If none works or proof is unavailable, report `Unresolved`. Approved `Tolerate` policy from #437 remains distinct from forcing Rule-of-3 runtime gates.

## Main process / hook boundaries

```mermaid
flowchart TD
    A["Codex Main Agent executes Workflow"] --> T["Tool Execution"]
    T --> H["PostToolUse Hook"]
    H --> EV["Objective Evidence only<br/>no Error Class verdict or auto dispatch"]
    EV --> SUS{"Main Agent suspects a real problem?"}
    SUS -->|No| A
    SUS -->|Yes| CAP["Level 1 A · Capture<br/>raw Evidence / source / unknowns"]
    CAP --> TRI["Level 1 B · Triage"]
    TRI --> FAST{"Already-approved Tolerate?"}
    FAST -->|Yes| OP["Bounded local retry / report UNVERIFIED if needed"]
    FAST -->|No| DIS["Main Agent dispatches Reviewer during Triage"]
    DIS --> SH["SubagentStart Hook"]
    L[("Existing Error Ledger / registry")] --> SH
    SH --> CTX["Reviewer instructions + scoped Evidence<br/>relevant known issue summaries, not verdicts"]
    CTX --> RV["Reviewer independently tests claim and counterevidence"]
    RV --> FIND{"Reviewer finding"}
    FIND -->|Not confirmed| A
    FIND -->|Inconclusive| HOLD["Hold / more Evidence / Owner decision"]
    FIND -->|Confirmed| ID["C · Identify this Occurrence and Class"]
    ID --> BL{"Identified and blocking?"}
    BL -->|No, nonblocking| DEFER["Record and defer"]
    BL -->|No, unidentified| HOLD
    BL -->|Yes| D["D · Decide disposition"]
    D --> PATH{"Allowed path"}
    PATH -->|Converge| FIX["Direct repair"]
    PATH -->|Avoid| ALT["Scoped Workflow replan<br/>preserve obligations"]
    PATH -->|Approved Tolerate| PT["Approved bounded treatment"]
    PATH -->|None| U["Unresolved / no false PASS"]
    FIX --> E["E · Treat"]
    ALT --> E
    PT --> E
    E --> LOCAL["Level 2 local correction + verification"]
    LOCAL --> CHECK{"Result?"}
    CHECK -->|Correctable inside Action and budget| LOCAL
    CHECK -->|Complete or cannot resolve| FG["F Deliver → G Accept<br/>independent check and honest outcome"]
    FG --> OUT{"Accepted?"}
    OUT -->|Verified| A
    OUT -->|Not verified| U
```

**Note:** The graph is the approved *logical behavior*, not a claim that the current Codex host automatically wires the `SubagentStart` event to a particular review request or the corresponding ledger item. Treatability, reviewer dispatch, Workaround and independent verification belong to Workflow/Agent decisions, not Hook control.

## Reviewer entry — progressive disclosure, without losing cognition

```mermaid
flowchart LR
    OBS["Main Agent observes problem"] --> CAP["Level 1 A · Capture<br/>Evidence only"]
    CAP --> TRI["B · Triage: dispatch Reviewer"]
    TRI --> PKT["Dispatch packet<br/>hypothesis + scope + Evidence"]
    PKT --> SEL["SubagentStart adapter<br/>reviewer agent_type matched"]
    IDX[("Existing Ledger + registry<br/>candidate known issues")] --> SEL
    SEL --> MIN["Reviewer entry context<br/>verify what, Evidence pointers,<br/>relevant issue ID / title / brief description"]
    MIN --> REV["Independent Reviewer"]
    REV --> MORE{"Need deeper history?"}
    MORE -->|Yes| L2["Open relevant Level 2 reference"]
    L2 --> L3["Level 3 Script/Skill if necessary"]
    MORE -->|No| FIND["Finding with Evidence<br/>not a copy of historic verdict"]
    L3 --> FIND
    FIND --> NEXT["Confirmed → Level 1 C Identify<br/>Not confirmed → dismiss; inconclusive → hold"]
```

Example **illustrative only** (not a mandated schema or a confirmed matching result):

```text
Role: Independent Reviewer — treat the Main Agent's suspicion as unverified.
Scope: Verify whether the generated report violates its terminal-status rule.
Evidence: tool result reference <tool_use_id> + target file path + reproduction.
Related historical issues (orientation, NOT findings):
  - E-0002: Report must terminate with the expected STATUS line; check the actual last line.
  - E-0003: Commit message format failures; consider only if the task involves commit creation.
Details: Open the referenced ledger entry/Level 2 diagram only if needed.
Return: Confirmed / Not confirmed / Inconclusive + evidence and counterexamples.
```

**Relevance filter:** The example shows what *a candidate summary* might look like; the real hook should include only items relevant to the Reviewer's task/step and the available index. No match → instructions and task evidence only, not all known issues or fabricated classifications. These summaries are **not trusted verdicts**; quoted history may be incomplete or stale. A simple ID/title/one-line description is enough to raise awareness without preloading solutions.

## Codex event/output contract (official reference verified 2026-11-13)

| Event | Host contract | Design use | Boundary |
| --- | --- | --- | --- |
| `PostToolUse` | After supported local tool results including nonzero Bash; has `tool_name`, `tool_use_id`, `tool_input`, `tool_response`; model-visible output through JSON `hookSpecificOutput.additionalContext`; plain stdout ignored | Observation + Evidence (not diagnosis) | Output payload is tool-specific; there is no universal exit-status field; don't claim all tools or hosted tool coverage |
| `SubagentStart` | At child start; `matcher` filters `agent_type`; output supports plain stdout developer context or JSON `hookSpecificOutput.additionalContext` scoped to child | Reviewer instructions + relevant issue index | Native hook input does **not** include the Reviewer dispatch task, Error Occurrence ID or ledger match by default: acquire only through an existing reliable scoped packet/state contract; no transcript-format assumption |
| `UserPromptSubmit` / `SessionStart` | Prompt/entry and session/resume/compact context | Context continuity when needed | No need to inject the entire ledger/solutions; prompt event matcher is ignored |
| `PreModelRequest` | Runs before each model request, diagnostic output only | Observability, **not** context injection | Cannot implement missing `PostToolBatch` with it |
| `SubagentStop` | At child exit, Hook event available | Optional evidence/diagnostic | Cannot replace the Reviewer verdict or independent verification |
| `PreToolUse` | After model has chosen the tool, before execution | Not the primary post-error path | May be too late to change already chosen tool |

Use **nonblocking advisory output**. For `PostToolUse`, avoid `decision: "block"`, `continue: false`, or status/error replacement as the Error Hook is not a policy gate. Hook `additionalContext` is bounded and scoped; a redundant tool-result echo should be suppressed. Host trust/installation/version and child availability must be tested before claiming live receipt.

Official: https://learn.chatgpt.com/docs/hooks

## Important operational trap: how does `SubagentStart` locate this review?

The official Codex input for `SubagentStart` has `agent_id`, `agent_type`, `turn_id`, `permission_mode`, plus common session information; **it does not document a native `review_task` / `problem_id` field**. Therefore an adapter must not pretend the event itself identifies the current disputed evidence or selected known issues.

- Main Agent supplies the **review task and evidence references** as part of its normal child dispatch.
- If an **existing trustworthy task-scoped context/packet** is available to the Hook, use it to retrieve **candidate issue summaries** from the existing ledger/registry; otherwise give only generic reviewer instructions and let the Reviewer resolve the references itself.
- No additional persistent error memory or global scratch file is authorized here. The exact scoped context handoff mechanism needs implementation/real-host proof under #394.
- The Hook may filter by `agent_type`, but do not claim that every Codex agent type called `reviewer` exists on every installed host/version. Test actual child profiles and inherited context.
- Main Agent may suspect a non-tool error (review finding, wrong reasoning, stale fixture). `PostToolUse` is not a prerequisite for dispatching a Reviewer.

## Proposed test evidence, not pass claims

| Probe | What would count as evidence |
| --- | --- |
| Failed local tool | `PostToolUse` fires with reproducible tool data; Hook output contains only evidence and no verdict |
| Duplicate tool output | No extra model context when original tool result already provides sufficient evidence |
| Reviewer handoff | Live `SubagentStart` receives scope, evidence and related known issue summaries; child input actually shows the summary |
| Historical issue cross-check | Reviewer can challenge a historical entry, inspect counterevidence and return `Not confirmed` |
| No matching issue | No unrelated problem list, false classification or wasted deep loading |
| Workaround | Main Agent replans affected segment only, preserved obligations are independently verified |
| No viable route | `Unresolved` reported, no false PASS |
| Trust / async / multi-tool | Distinguish hook fired, emitted output, model receipt, reviewer used cue and outcome; no false assumption of global ordering |

**Status:** Choices (1) and (2) are *owner-decided*. Codex host event capability is *officially documented*. Hook installation, child review dispatch linkage, model-visible history list and actual behavior are *unchecked*. [#394](https://github.com/dyphn1/Harness-everything/issues/394) owns implementation/validation. OpenCode V1 and V2 remain open in #439.
