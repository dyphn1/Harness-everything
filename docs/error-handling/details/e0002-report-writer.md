# E-0002 Treat — Level 3 report-writer contract and test cases

> **Proposed design / Level 3 supporting contract, NOT an implemented CLI.** Companion to the [E-0002 Level 2 Action Map](../actions/e0002-action-map.md) and [Level 1](../README.md) in [#437](https://github.com/dyphn1/Harness-everything/issues/437) and the Error Handling subtree [#402](https://github.com/dyphn1/Harness-everything/issues/402). This specifies **what the agent should do next time** and **which mechanical operation should prevent a repeat**. The proposed commands below do not exist yet; this document does not change production hooks, report rules or ledger state.

## Problem to prevent

**E-0002** (`report-protocol`) recurs when a report lacks its required **raw, column-zero, terminal** `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line, or when a harness-label appears after it. Some failures happen in `codex exec -o` outputs where the report is also the final turn text. Previous instructions and reminders were not enough: the next agent can make the same mistake again.

**Treatment direction (proposal):** stop using free-form report editing for the terminal protocol. The **agent supplies report content and an evidence-grounded status**, while one **scoped CLI/script writes and verifies the final report file**. Preserve free-form content authoring; restrict only the structured output operation. Do not add a global document governor, second Error Ledger, automatic report generation for unrelated tasks, or a count-driven lock.

**Action ownership:** A Capture records facts; B Triage and C Identify establish the case; D Decide chooses treatment. **E Treat defines/applies the mechanical report-writing method**; F Deliver gives the agent a concise instruction and the available CLI; G Accept checks its result. This is an **E-0002-specific Action detail**, not a second Level 1 flow or a claim that all classes have the same treatment.

## Level 3 · Script-mediated operation (supporting the Level 2 block)

```mermaid
flowchart TD
    INPUT["D · Decide: valid selected disposition"] --> NEED{"Report-writing operation required?"}
    NEED -->|No| OTHER["Perform only the selected applicable operation<br/>no automatic report requirement"]
    NEED -->|Yes| AUTHOR["Agent supplies true task outcome and report body<br/>DONE / BLOCKED with reason"]
    AUTHOR --> SOURCE{"Source of content?"}
    SOURCE -->|"Ordinary body file"| STAGE["Provide body file to script"]
    SOURCE -->|"codex exec -o"| RAW["Host -o writes raw output to staging input<br/>never finalized as the report directly"]
    RAW --> EXTRACT["Script applies specified host-aware<br/>extraction/validation of raw output"]
    EXTRACT --> STAGE
    STAGE --> WRITE["Script writes terminal STATUS atomically<br/>then reads and checks finished artifact"]
    WRITE --> RC{"Exit code 0?"}
    RC -->|No| ERR["Return code + unmet condition;<br/>agent corrects inside Treat or records unresolved"]
    ERR -->|"correctable"| AUTHOR
    ERR -->|"not satisfied"| F
    RC -->|Yes| F["F · Deliver actual result / usable guidance"]
    OTHER --> F
    F --> G["G · Accept against applicable contract<br/>and separate task evidence"]
```

The E-0002 report script is **proposed, not deployed**. The Agent determines outcome; a mechanical script owns report assembly, validation and useful errors. The response block may choose a fitting operation without creating a new Level 1 branch. A failed script result does **not** bypass F/G or count as a successful report; unresolved evidence is delivered and the occurrence remains open.

## Agent-facing procedure — proposed operational contract

For a step **explicitly required to produce a report**:

1. **Perform the work and collect evidence.** The agent must decide the true task/packet status based on observed results. `DONE` is not inferred by the CLI from a successful invocation; `BLOCKED` requires an actual reason. A completed RED experiment is not automatically product GREEN.
2. **Prepare only the free-form body** in a staging file. Do not add a terminal STATUS line or a harness-label to that body. If the host's `-o` captures the turn's final text, treat it as **script input / raw staging output**, not the finished report.
3. **Call the report writer** with the body path, final output path, and explicit status; the writer adds exactly one terminal STATUS line and writes the complete report atomically.
4. **Check the written file**, not merely the CLI stdout, and retain the result as evidence. Do not append to the finalized report; to revise, change the body and call the writer again.
5. **Return the report reference and verified result** to the caller. A separate final turn keeps its own applicable host label contract. For any shared raw `-o` output, the **script** must apply an explicit host-aware extraction contract before writing the final report; return nonzero with raw evidence if it cannot do so. Do not silently strip arbitrary metadata or declare a contract exception deployed.

### Proposed command interface — design examples, NOT currently executable

```bash
# Positive result: content is provided by the agent; STATUS is written by the tool
harness report write --body-file work/report-body.md --output reports/review.md --status DONE
harness report check --file reports/review.md

# Blocked result: same writer; explicit failure reason is required
harness report write --body-file work/report-body.md --output reports/review.md --status BLOCKED --reason "required verification unavailable"
harness report check --file reports/review.md
```

These are **candidate CLI verbs**, not a mandate to create a global `harness` binary. A small repository-local Node.js script with equivalent `write` / `check` operations is sufficient for the first vertical slice. The agent-facing instruction should reference the **actual installed command and version**, not copy these placeholders as if working already.

### Minimal writer and checker contract

| Responsibility | Expected behavior |
| --- | --- |
| `write` input | Existing body file, designated report output path, explicit `DONE` / `BLOCKED`, mandatory non-empty reason for `BLOCKED` |
| `write` output | Preserve body content, add a single newline-separated terminal control line at **column zero**, write atomically, fail without corrupting the previous target |
| Structural validation | On the finished output, check exactly one terminal protocol line, nothing after it (including hidden label), and read-back matches what was written |
| Containing structured fields | Reject conflicting column-zero terminal STATUS lines and harness-label metadata in the submitted body; make the conflict explicit rather than silently discarding unknown content |
| Artifact roles | `codex exec -o` writes raw output as **script input**; the script converts and verifies the designated final report according to a host-aware contract. If ambiguous, return nonzero; no hidden manual rewrite |
| Failure outcome | Nonzero exit + actionable diagnostics; Agent may revise within Treat or deliver outstanding evidence via F/G; no automatic `DONE`, preserve prior target and raw source |
| Scope | Operate on explicitly designated report output only; do not rewrite unrelated files, judge semantic success, touch the Ledger, or automatically change permissions |
| Revision | Re-run `write` using the edited body + true status; never mutate the terminal report with ordinary append commands |

**Design constraint:** `-o` must be handled as script-mediated output. Parsing host metadata is a deterministic responsibility of the proposed script under a defined contract. If the script cannot distinguish required protocol from host-owned label safely, **return nonzero** with the original raw output and let the Agent handle that result; do not imply an unimplemented exception has shipped.

## Interaction with other Actions and existing facilities

```mermaid
flowchart LR
    A["A–C · ASSESS<br/>observed/identified error"] --> D["D · Decide<br/>selected, validated disposition"]
    D --> E["E · Treat<br/>agent uses script and return codes"]
    E --> F["F · Deliver<br/>selected operation + result or failure"]
    F --> G["G · Accept<br/>mechanical check + substantive evidence"]
    F -. "reusable capability, not a flow edge" .-> HOOK["Later relevant Hook / Skill disclosure"]
```

The future Hook/Skill reference is **not** a G feedback/recurrence edge, nor does F make future tasks part of this same Error Occurrence. A new recurrence starts as a **new Capture**; a correction after nonzero exit remains within the current local Action block when permitted.

- **#359:** existing E-0002 Ledger remains class/history authority; do not create a second database.
- **#394 / ROUTE-001:** Hook provides the **available command only when relevant**; it does not enforce task success or select the disposition. A retired lesson reminder does not remove still-needed operational instructions.
- **#437:** scoped CLI/script is a proposed deterministic validator, **not** a mandatory global document controller. Validation failures are returned for Agent handling, not converted to hidden branching rules.
- **Decide/Accept:** when a machine-checkable condition or approval is not met, the script returns nonzero with the unmet requirement. The Agent can revise appropriately or preserve unresolved status. Owner authorization cannot be fabricated by a script, and a zero script exit code never proves substantive task correctness.

## Proposed acceptance before implementation

| Test case | Expected observable result |
| --- | --- |
| Valid body + DONE | Final file ends in exactly `STATUS: DONE`; CLI `check` passes |
| Valid body + BLOCKED + reason | Final file ends in `STATUS: BLOCKED: <reason>`; check passes |
| BLOCKED without reason | Write rejected; existing report left untouched |
| Body contains conflicting terminal STATUS or harness-label | Write rejected with useful explanation, no silent normalization |
| Agent revises body after earlier report | A new `write` replaces the report atomically; one terminal STATUS remains |
| `codex exec -o` emits trailing harness-label | Raw `-o` is routed **through the script** to produce/check the final report; script returns nonzero on unsafe/ambiguous transformation |
| Tool unavailable, bad path or read-back fails | Return nonzero with reason; Agent handles correction or delivers UNVERIFIED/unresolved result via F/G; raw evidence retained |
| Report not required | No invocation, no forced report |
| Writer produces compliant format but underlying result is wrong | Structural PASS only; review/behavior acceptance stays separate |

**What to measure:** E-0002 recurrence in later **real report-writing tasks**, whether the agent actually invoked the designated writer, structural violations after invocation, and elapsed/tool/review cost relative to hand-writing. Do not declare E-0002 rooted out merely because a diagram or a one-off check exists.

## Owner discussion items

1. Should the first implementation be a small Node.js `report write/check` script under the existing repository, rather than a new global CLI? **Recommended: yes.**
2. For `codex exec -o`, route raw output to a **script**, and let the script generate/check the final report. No manual coordinator rewrite or output-contract exception is assumed.
3. Define the **script's host-aware input/output and extraction contract** for shared `-o` artifacts; ambiguous input returns nonzero, not guessed normalization.

This design leaves A Capture focused on facts and E Treat on the executable operation: the next agent receives a repeatable action, **validated return codes**, and a way to handle a failed condition, not merely an explanation of the last mistake.
