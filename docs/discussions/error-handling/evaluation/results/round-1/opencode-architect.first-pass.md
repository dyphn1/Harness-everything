# Blind first pass — architect review of error-handling diagrams (frozen at 33e1ef78)

Stimulus: `evaluation/diagram-only.md` only. Nothing outside this directory was read. No assumption that any box corresponds to working commands, machinery, hooks, or live checks.

## My reading

**What the drawings themselves establish (directly supported):**

- Diagram 1 is a top-down flowchart with a single start (`S`) and a single shared end (`Z`). It is divided into two labeled subgraphs: `ASSESS · View 2 composition` and `RESPOND · View 2 composition`. Both carry the annotation "View 2 composition", which is text on the drawing.
- **ASSESS** (Diagram 1) contains: `A · Capture` → `B · Triage`; a triage gate `T {Approved tolerate class?}` whose **Yes** branch leads to an operation-retry loop (`R "Retry this operation (max 3)"` → `REC {Recovered?}` → `RESUME "Resume interrupted work"` or `UNV "Mark step UNVERIFIED; report; continue independent work only"`) and exits to `Z` — this branch never reaches `C`. The **No** branch goes through a reviewer gate `REAL {Real problem? (reviewer)}` (No → `DISMISS`; Unclear → `OWNER`; Yes → `BLOCK {Blocks current main path?}`), then to `C · Identify`, then a ledger gate pair (`KNOWN {Existing class / signature?}` → `OCC "Record occurrence in existing ledger"` or, for a new class, `APPROVAL {Owner approves definition?}` → `DEF "Define class / signature in existing ledger"` or `HOLD`), then a final gate `NOW {Blocking main path?}` whose **No** branch exits as `DEFER "Record only; defer treatment"` and whose **Yes** branch exits the subgraph into `D`.
- **RESPOND** (Diagram 1) contains: `D · Decide disposition («expanded in View 3»)` → `MECH {Mechanical prevention feasible within budget?}` → (`Yes`) `RECHECK {Same class still yields new instances in bounded review?}` → `CONV "Converge"` or `DROP {Can action be dropped or restricted?}`; (`No`) `DROP`; `DROP` → `AVOID "Avoid"` or `TOLAPP {Owner approves Tolerate?}` → `TOL "Tolerate"` or `PENDING "Keep unresolved; do not bypass required checks"`; `CONV`/`AVOID`/`TOL` → `E · Treat (define acceptance first)` → `F · Deliver relevant context` → `G · Accept and retire` → `RESULT {Review disposition outcome}` → `RETIRE` / `KEEP` / `OPEN`, all exiting to `Z`.
- Diagram 1 draws a dashed recurrence edge `RETIRE -. "Later recurrence of same class; re-evaluate" .-> D` — re-entry into `D`, not into `A`.
- Diagram 2 is labeled `Error Handling — composed activity (View 1)`. Its subgraphs are annotated `ASSESS · same block in View 1` (containing `A → B → C`, left-to-right) and `RESPOND · same block in View 1` (containing `D → E → F → G`), with an edge `C → D` closing the two blocks. External dashed participants: `REVIEW ["Reviewer / Owner"]` (judgement/approval → B; approval → D), `LEDGER [("Existing Error Ledger · #359")]` (find/record → C; mechanism/disposition → E), `HOOK ["Existing bounded context delivery · #394"]` (reuse → F), and a recurrence loop `G -. "newly observed recurrence" .-> INPUT`, where `INPUT ["Agent failure / reviewer finding / later observation"]` feeds `A`.
- Diagram 3 is titled inside its subgraph label: `D_DETAIL ["D · Decide disposition (expanded from Views 1–2)"]`, with entry stub `IN ["C · Identify: class + evidence"]` and exit stub `OUT ["E · Treat: define acceptance, then act"]`. Its decision tree (`Q → R → C[Converge] / A → V[Avoid] / T → TOL[Tolerate] / WAIT`) is structurally identical to Diagram 1's RESPOND decision chain (`MECH → RECHECK → CONV / DROP → AVOID / TOLAPP → TOL / PENDING`). It has no end nodes, no `F`/`G`/`RESULT`, and `WAIT ["Unresolved; do not silently waive checks"]` has no outgoing edge.

**What I infer (marked as inference):**

- The two named partitions mean: **ASSESS** = the intake-and-classification phase (capture the failure/finding, triage against pre-approved tolerate classes, judge whether it is a real problem, identify/classify it against an existing error ledger); **RESPOND** = the disposition-and-closure phase (choose a disposition among mechanical prevention / converge / avoid / tolerate, treat it, deliver context to the worker, and accept-and-retire). This reading is inferred from node names, not stated anywhere as a definition.
- Diagram 1 is the *expanded* (View 2) rendering of the same two blocks that Diagram 2 shows *composed* (View 1). Diagram 3 is a drill-down of node `D` only — a sub-activity expansion, not a separate workflow and not a mere cross-reference (it carries a full flow, entry/exit stubs, and matching annotations `«expanded in View 3»` / "expanded from Views 1–2").
- View 1's straight-line composition (`A→B→C→D→E→F→G`) is best read as an elided summary of the mainline path through View 2's branchy flow, with early exits (RESUME, UNV, DISMISS, OWNER, HOLD, DEFER, PENDING) suppressed. This is consistent with the "same block" annotations but is not proven by them.
- View 2's `T →|Yes| R` retry branch and View 1's `G -. recurrence .-> INPUT` suggest the artifact describes an agent-operational error-handling protocol (retry, resume, UNVERIFIED) *and* a review governance process (reviewer/owner gates, ledger, converge/avoid/tolerate dispositions) fused into one activity.

**Stable Actions vs incidental decision/control nodes:**

- **Stable Actions** (the recurring skeleton present in Views 1 and 2, with `D` further expanded in View 3): `A · Capture`, `B · Triage`, `C · Identify`, `D · Decide disposition`, `E · Treat`, `F · Deliver relevant context`, `G · Accept and retire`.
- **Decision/control nodes**: `T`, `REC`, `REAL`, `BLOCK`, `KNOWN`, `APPROVAL`, `NOW` (ASSESS side); `MECH`, `RECHECK`, `DROP`, `TOLAPP`, `RESULT` (RESPOND side); `Q`, `R`, `A`, `T` (Diagram 3). These are inlined diamonds inside the blocks in View 2. They are *not* purely incidental: the disposition decision chain (MECH/RECHECK/DROP/TOLAPP) survives verbatim into Diagram 3 (`Q/R/A/T`), so it is stable *content* drawn as control nodes. The genuinely incidental ones are the ASSESS-side gates (`T`, `REAL`, `BLOCK`, `NOW`), which have no counterpart in View 1 or 3.
- **Outcome/terminal actions**: `RESUME`, `UNV`, `DISMISS`, `OWNER`, `HOLD`, `DEFER`, `PENDING`, `RETIRE`, `KEEP`, `OPEN`, plus `CONV`, `AVOID`, `TOL`, `OCC`, `DEF`.

**Is the proposed correlation textual, logical, or executable?**

- **Textual + logical, not executable.** The cross-view correlation rests on text annotations ("same block in View 1", "View 2 composition", `«expanded in View 3»`, "expanded from Views 1–2") and on logical/structural correspondence (identical decision-tree shape between Diagram 1's RESPOND and Diagram 3; identical A–G node sequence in Views 1–2). It is **not executable/machine-checkable**: Mermaid node ids collide across diagrams (`C` = "C · Identify" in Diagrams 1–2 but `C` = "Converge" in Diagram 3; `R` = "Retry this operation (max 3)" in Diagram 1 but `R` = the bounded-review diamond in Diagram 3; `A` = "A · Capture" vs `A` = "Can action be dropped / restricted?"; `T` = "Approved tolerate class?" vs `T` = "Owner approves tolerate class?"). No formal mapping table links `MECH↔Q`, `RECHECK↔R`, `DROP↔A`, `TOLAPP↔T`, `PENDING↔WAIT`; a human must match them by label and position. Nothing in the drawings is runnable.

**Compatibility regarding recurrence and exits:**

- **Recurrence: the diagrams are *not fully compatible* as drawn.** Diagram 1 loops `RETIRE -.-> D` (re-entry at *Decide disposition*, bypassing Capture/Triage and the reviewer gates). Diagram 2 loops `G -.-> INPUT` → `A` (full re-entry at *Capture*). Different re-entry points, different triggering nodes (`RETIRE` vs `G`), different trigger wording ("Later recurrence of same class; re-evaluate" vs "newly observed recurrence"). They can be reconciled only by assuming two distinct loops (disposition-only re-evaluation vs full re-capture), which the drawings never state.
- **Exits: compatible only under the "partial views" reading.** Diagram 1 has ten distinct exits into a single shared `Z`. Diagram 2 shows *no* exits at all (its flow ends at `G` plus the recurrence loop), and Diagram 3 has no end nodes and one dead-end (`WAIT`). If Diagram 2 is read as a complete process, it contradicts Diagram 1's ten early exits; the "same block" annotation supports reading it as an elided composition, but the drawings never say "exits elided".

## Diagram-to-diagram mapping

| View 1 (Diagram 2) | View 2 (Diagram 1) | View 3 (Diagram 3) | Note |
|---|---|---|---|
| `INPUT → A` | `S → A` | — | entry |
| ASSESS `A · Capture` | `A` | — | stable |
| ASSESS `B · Triage` | `B` (+ gates `T`, `REAL`, `BLOCK`) | — | View 1 elides the gates |
| ASSESS `C · Identify` | `C` (+ `KNOWN`, `APPROVAL`, `OCC`, `DEF`, `NOW`) | `IN` stub | |
| edge `C → D` | `NOW -->\|Yes\| D` | `IN → Q` | View 1 draws it unconditional; View 2 gates it on `NOW` |
| RESPOND `D` | `D` + inline `MECH/RECHECK/DROP/TOLAPP` | whole `D_DETAIL` (`Q/R/A/T`) | expanded in View 3 per annotation |
| — (`MECH↔Q`, `RECHECK↔R`, `DROP↔A`, `TOLAPP↔T`, `PENDING↔WAIT`) | | | matched by structure/label only, not by id |
| RESPOND `E · Treat` | `E` | `OUT` stub | |
| RESPOND `F · Deliver relevant context` | `F` | — | absent from View 3 |
| RESPOND `G · Accept and retire` | `G` + `RESULT` → `RETIRE/KEEP/OPEN` | — | absent from View 3 |
| `G -. recurrence .-> INPUT → A` | `RETIRE -. recurrence .-> D` | — | **divergent re-entry points** |
| dashed `REVIEW → B, D`; `LEDGER → C, E`; `HOOK → F` | not drawn (only "(reviewer)"/"Owner" gate labels) | not drawn | participants appear only in View 1 |
| no exits drawn | 10 exits → `Z` | no end nodes; `WAIT` dead-ends | |

## Unclear or potentially misleading

1. **Unconditional `C → D` in View 1 vs gated `NOW →|Yes| D` in View 2.** A reader of Diagram 2 alone concludes every identified item reaches disposition; Diagram 1 shows `DEFER`, `HOLD`, `DISMISS`, `OWNER`, `RESUME`, `UNV` leaving before `D`. Misleading unless "exits elided" is assumed.
2. **Two different "tolerate" mechanisms share one word.** Triage-time `T {Approved tolerate class?}` routes to a *retry* loop and never reaches `C`/RESPOND; disposition-time `TOLAPP {Owner approves Tolerate?}` is a governance decision after `D`. A new architect could wrongly conflate the pre-approved tolerate class registry with the owner-approved Tolerate disposition; the diagrams never relate them.
3. **Node-id collisions across diagrams** (`C`, `R`, `A`, `T` mean different things in Diagram 3 than in Diagrams 1–2). Any tooling or careful reader cross-referencing ids will be misled; only labels disambiguate.
4. **Recurrence loops disagree** (`RETIRE→D` vs `G→INPUT→A`); `RETIRE` is simultaneously an outcome terminal (`RETIRE → Z`) and a loop source, so a reader may not realize the loop exists.
5. **Diagram 3's incompleteness is easy to miss.** It stops at `OUT (E · Treat)` with no `F`/`G`/`RESULT` and no end states; `WAIT` dead-ends with no exit. Read standalone, it looks like a complete mini-workflow whose tolerate path evaporates.
6. **Mixed vocabularies** — agent-runbook terms (`Capture`, `Retry this operation (max 3)`, `Resume interrupted work`, `Mark step UNVERIFIED; … continue independent work only`) alongside code-review governance terms (`reviewer`, `ledger`, `Converge/Avoid/Tolerate`, `retire unneeded lesson`). The drawings do not say whether this is one protocol or two overlaid ones.
7. **"retry this operation (max 3)"** — which operation (the failing agent operation? the review step?) is undefined; nothing else in any diagram defines "operation".
8. **Pending items have no re-entry path**: `OWNER`, `HOLD`, `PENDING`, `WAIT`, `DEFER`, `KEEP`, `OPEN` all terminate without any drawn wake-up/queue mechanism, yet `KEEP` is "Keep tolerate class active" — a stateful claim with no loop to sustain it.

## What I could not determine

- Whether any box corresponds to working commands, automation, hooks, or live checks — unknown by construction (diagram-only stimulus; I do not assume so).
- What "budget" (`MECH`) and "bounded review" (`RECHECK`) concretely are — undefined terms.
- Whether triage's `T {Approved tolerate class?}` consults the `Existing Error Ledger · #359` — the ledger is only wired to `C` and `E` in View 1, not to `B`.
- Who/what `REVIEW ["Reviewer / Owner"]` is per-gate: View 1 wires one combined entity to `B` and `D`, while View 2's gates name "(reviewer)" only on `REAL` and "Owner" on `APPROVAL`/`TOLAPP`. The reviewer/owner split is inferable but not drawn consistently.
- What `F "Deliver relevant context"` delivers, to whom, and what `HOOK · #394` actually is beyond its label.
- What `UNV`'s "report" reports into — no reporting target node exists.
- Whether `DEFER`/`HOLD`/`PENDING` items are ever revisited, and by what trigger — no edges.
- Whether the ten `Z` exits are meant to be distinguishable end states or one generic end — `Z` is a single node.
- Whether View 2's `RETIRE -.-> D` loop and View 1's `G -.-> INPUT` loop are the same loop seen at different zoom (my best guess) or two different loops (also a defensible reading) — unknowable from the drawings.
- What the references `#359` and `#394` point to — opaque external labels.

## Two (plus) interpretations a new architect could reasonably make

1. **"Diagram 3 is a third, independent workflow for deciding dispositions."** — **Unsupported** as an independent workflow; it duplicates the disposition logic that already exists inside Diagram 1's RESPOND block. Its own header ("expanded from Views 1–2"), the `IN (C · Identify)` entry and `OUT (E · Treat)` exit, and the `«expanded in View 3»` annotations in Diagrams 1–2 make it a **sub-activity drill-down of node `D`** — that reading is **supported**. Mere cross-reference is **unsupported** (it carries real flow content, not just a pointer).
2. **"Every item flows through ASSESS into RESPOND."** — **Supported by** Diagram 1's unconditional `C → D` edge and the linear View 1 composition; **ambiguous overall**, because Diagram 1 shows seven early exits that never reach `D` (`RESUME`, `UNV`, `DISMISS`, `OWNER`, `HOLD`, `DEFER`, `PENDING`). A new architect taking View 1 at face value would design for "all findings reach disposition", which Diagram 1 contradicts.
3. **"Recurrence re-enters at Capture for full re-triage."** — **Supported by** Diagram 2 (`G -.-> INPUT → A`); **ambiguous/contradicted by** Diagram 1 (`RETIRE -.-> D`), which implies re-entry at disposition without re-triage. At least one of the two readings is wrong as drawn.
4. **"The triage-time 'Approved tolerate class?' path is the same mechanism as the disposition-time Tolerate."** — **Unsupported**: the triage path retries the operation and exits (`RESUME`/`UNV`); the disposition path is an owner-approved governance decision followed by `E · Treat`. Different gates, different owners, different outcomes; the shared word "tolerate" is the only link.
5. **"The disposition decision chain (mechanical → converge → avoid → tolerate) is itself a stable sub-activity of `D`."** — **Ambiguous leaning supported**: it survives intact from View 2 into View 3, so it is stable content; but it is drawn as inline diamonds in View 2 rather than as a named block, so a reader could equally treat it as incidental control detail of `D`.

## Confidence 0–5 with reasons

**3 / 5.**

- *Why not higher:* the three views disagree on substantive points as literally drawn (recurrence re-entry point; unconditional vs gated `C→D`; exits present vs absent), several load-bearing terms are undefined ("budget", "bounded review", "operation"), the participant wiring (Reviewer/Owner, Ledger, Hook) exists only in View 1, and the cross-view correlation is textual/label-based with colliding node ids — so any stronger claim about intent or behavior would exceed what the drawings establish. I also could not verify any runtime claims by design.
- *Why not lower:* the core reading is well-supported by the drawings themselves: two named partitions whose block membership and View-1 correspondence are explicitly annotated (`same block in View 1`); A–G as the stable skeleton recurring across all views; Diagram 3 as a `D`-only expansion with structurally identical decision logic; and a consistent overall shape (single start, ten exits, one shared end in View 2). The structural identity between Diagram 1's RESPOND tree and Diagram 3 is directly visible, not inferred.

STATUS: DONE
