# Blind first pass — UML / software architect

Stimulus: `evaluation/diagram-only.md` only (Views 1–3, frozen at `8e76b8d2`). No other material consulted.

## My reading

**The two named partitions in Diagram 1 (View 1).**
- `ASSESS` is the intake/triage/identification phase: Capture → Triage → (tolerate-class shortcut, or reviewer-judged reality check) → Identify (classify into the "existing ledger", with owner approval required for a *new* class). Its exits are: resume after retry, mark-UNVERIFIED, dismiss, owner-decision hold, pending-hold, defer, or hand-off to RESPOND only when the recorded problem **blocks the main path** (`NOW` gate).
- `RESPOND` is the disposition/treatment phase: Decide disposition → Treat → Deliver relevant context → Accept and retire, ending in one of three dispositions (retire the lesson / keep tolerate class active / keep open with outstanding evidence).
- Reading them as sequential phases of one workflow is **supported** by View 2, which composes both subgraphs inside a single "Error Handling — composed activity" and joins them with `C -->|"blocking only"| D`, exactly mirroring View 1's `NOW -->|Yes| D`.

**Relationship to Diagram 2 (View 2).** View 2 is the same activity at coarser granularity, not a different workflow: the node labels (`A · Capture` … `G · Accept and retire`), subgraph names (`ASSESS`, `RESPOND`), and the "blocking only" join all match View 1. The file itself says node ids are local per diagram, so the only sound cross-view mapping key is the `X · Label` text. View 2 adds what View 1 lacks: external participants (`REVIEW`), the ledger data store (`LEDGER`, "#359"), a reuse target (`HOOK`, "#394"), the entry stimulus (`INPUT`), and two feedback loops from `G`. Its note "early exits and decisions are omitted in this view; see View 1" makes View 1 the authoritative control-flow source and View 2 the participant/data-source view. **Supported.**

**Is Diagram 3 (View 3) a separate workflow, sub-activity, or cross-reference?** It is a **sub-activity (drill-down) of node D**, not a separate workflow and not a mere pointer. Evidence: both View 1 and View 2 label D with `«expanded in View 3»`, and View 3's own subgraph is titled `D · Decide disposition (expanded from Views 1–2)`; its content (MECH/RECHECK/DROP/AVOID/TOLAPP/TOL/CONV) is a copy of View 1's D-subtree with the same branch structure. It is *more* than a cross-reference because it carries real flow content, but it covers only node D's internals (it stops at `OUT`, the E·Treat stub). **Supported** — though a reader *could* mistake it for a standalone disposition workflow (see interpretations below).

**Stable Actions vs incidental decision/control nodes.**
- Stable, named Actions (the process vocabulary): `A · Capture`, `B · Triage`, `C · Identify`, `D · Decide disposition`, `E · Treat`, `F · Deliver relevant context`, `G · Accept and retire`. Secondary stable actions with real semantics: `R` (retry, max 3), `RESUME`, `UNV` (mark UNVERIFIED + report), `DISMISS`, `OCC` (record occurrence), `DEF` (define class), `HOLD`, `DEFER`, `CONV`, `AVOID`, `TOL`, `PENDING`, `RETIRE`, `KEEP`, `OPEN`.
- Incidental decision/control nodes (branch points only, no persistent meaning): `T`, `REC`, `REAL`, `KNOWN`, `APPROVAL`, `NOW`, `MECH`, `RECHECK`, `DROP`, `TOLAPP`, `RESULT`. Connectors/decorations: `S`, `Z`, and in View 2 `INPUT`, `REVIEW` (external actor), `LEDGER` (store), `HOOK` (existing mechanism).
- The A–G letters are explicitly stated to be drawing-local aliases, so the *labels* are the stable part, not the ids.

**Is the correlation textual, logical, or executable?** It is **textual and partly logical; not executable**.
- Textual: cross-view mapping rests entirely on matching label strings (`A · Capture`, etc.) and on the `«expanded in View 3»` annotations. Node ids are declared local, so nothing machine-readable links the views.
- Logical: the main spine (A→B→C→D→E→F→G, blocking-only join, D's branch tree) is consistent across Views 1–3.
- Not executable: no machine-joinable identifiers (stated explicitly), `max 3` retry budget has no defined counter or reset semantics, terminal "ends" for hold states (OWNER/HOLD/PENDING) are drawn as flow terminations but represent suspended work — a state machine cannot end a suspended item, so re-entry semantics are undefined.

**Compatibility regarding recurrence and exits.**
- Exits: **compatible by declaration.** View 2 says early exits and decisions are omitted and defers to View 1, and View 1 indeed shows six early exits (`RESUME`, `UNV`, `DISMISS`, `OWNER`, `HOLD`, `DEFER`) plus three disposition exits (`PENDING`, `RETIRE`, `KEEP`, `OPEN` — four, counting KEEP). No contradiction.
- Recurrence: **partially incompatible / underspecified.** View 1 draws exactly one recurrence edge: `RETIRE -.-> D` ("later recurrence of the SAME known class: re-evaluate disposition") — i.e., only from the *retire* end state. View 2 draws two loops from `G`: recurrence-of-same-class → D, and unrelated-NEW-problem → re-enter at Capture (`INPUT`). View 1 has **no** G→INPUT re-entry at all. So: (a) whether re-evaluation happens only after retirement or after `G` under any outcome (including `KEEP` — tolerate class stays active) differs between views; (b) the new-problem re-entry loop exists in only one view. A lenient reading ("View 2 is coarse, loops are illustrative") reconciles them; a literal reading does not.
- One more friction: recurrence re-enters at **D**, bypassing B/C. That matches "re-evaluate *disposition*", but it skips triage against the tolerate class (`T`) and any ledger lookup — a reader might expect re-entry at B (where `T` would route a known tolerate class instantly). Ambiguous as drawn.

## Diagram-to-diagram mapping

| View 1 | View 2 | View 3 | Match quality |
|---|---|---|---|
| A · Capture | A · Capture | — | exact |
| B · Triage | B · Triage | — | exact |
| C · Identify | C · Identify | `IN` ("C · Identify: class + evidence") | label-level match; V3 `IN` is a renamed stub |
| D subtree (MECH→RECHECK/DROP→CONV/AVOID/TOL/TOLAPP→PENDING) | D (collapsed) | `D_DETAIL` same branch tree | structurally identical; minor label wording differs (`RECHECK` phrasing; `PENDING` text "do not bypass required checks" vs "do not silently waive checks") |
| E · Treat (define acceptance first) | E · Treat | `OUT` ("E · Treat: define acceptance, then act") | consistent |
| F · Deliver relevant context | F (+ `HOOK #394` reuse) | — | V2 adds participant |
| G · Accept and retire | G (+ loops to D/INPUT) | — | V2 adds loops V1 lacks (see above) |
| T/REAL/KNOWN/APPROVAL/NOW decision layer | omitted (declared) | — | consistent with declared omission |
| — | LEDGER #359 → C (find/record), → E (mechanism/disposition) | — | V2-only data source |

## Unclear or potentially misleading

1. **`R` ("Retry this operation (max 3)") inside ASSESS.** It sits between triage and a recovery check, but what is being retried — the operation that produced the failure, or a step of the review workflow itself? "Retry this operation" reads as a runtime retry, which is odd inside a review/ledger workflow. `max 3` has no counter semantics (per occurrence? per class? reset on recurrence?). Potentially misleading: a reader may think the *workflow step* is retried.
2. **Terminal ends for suspended work.** `OWNER`, `HOLD`, `PENDING` flow to `Z((End))`, but their labels describe items that are still alive ("hold item", "keep pending", "keep unresolved"). As drawn, the process simply ends on a suspension — re-entry is undefined for these paths (unlike the retire-recurrence loop, which is drawn). Misleading if read as a state machine.
3. **Recurrence edge source mismatch** (RETIRE in V1 vs G in V2) as detailed above; a new architect cannot tell whether `KEEP` (tolerate class active) ever re-evaluates.
4. **Missing new-problem loop in View 1.** `G -. unrelated NEW problem → INPUT` exists only in View 2; View 1 has no path from any RESPOND node back to `A` or `S`. Literal readers of View 1 alone would conclude every new problem requires a fresh start from `S` — probably the intent, but then View 2's loop is an *extra* behavior, not just an omission.
5. **`NOW` ("Blocking main path?") only receives edges from `OCC` and `DEF`.** The tolerate-class shortcut (T→Yes) bypasses it entirely, and `DEFER` is only reachable *after* the NOW gate. So a known-class occurrence that blocks the main path goes to RESPOND, while a *newly defined* class follows the same gate — consistent, but nothing assesses blocking-ness for the retry path. A reader might expect the gate to apply everywhere.
6. **View 2's `REVIEW -. approval .-> D` but no approval edge into `APPROVAL` (C-path) or `TOLAPP`.** In View 1, owner approval gates new-class definition (`APPROVAL`) and tolerate (`TOLAPP`); View 2 shows approval only feeding D. Presumably `REVIEW` covers all approvals, but as drawn it's under-specified.
7. **Wording drift between V1 and V3** for `RECHECK` and `PENDING` (noted in the table). Same meaning, different text — since text is the only join key, drift is a real (if small) risk.

## What I could not determine

- What the overall system/process is (the diagrams never say; View 2's INPUT hint "agent failure / reviewer finding / later observation" suggests an agent-error-handling governance process, but that is inference, not established).
- Whether `LEDGER #359` and `HOOK #394` are existing, real components ("Existing" labels suggest reuse, but I cannot verify anything about them).
- What "within budget" means in `MECH` (time? complexity? review cost?) and who sets it.
- Whether the retry budget (`max 3`) persists across recurrences of the same class.
- What happens to `UNV` ("Mark step UNVERIFIED") downstream — the marked step is outside the diagram's scope; its later verification is not modeled.
- Who "reviewer" is in `REAL ("Real problem? (reviewer)")` versus `REVIEW` in View 2 — presumably the same actor, not established.
- Whether the `OWNER` node's end is a wait-state with later resume, or a true abandonment.

## Interpretations a new architect could reasonably make

1. **"View 3 is a separate, standalone disposition workflow"** — **unsupported** (better: ambiguous leaning unsupported). The `«expanded in View 3»` tags and the subgraph title tie it to node D, but nothing visually prevents a reader from treating it as an independent flow, since it has its own entry (`IN`) and exit (`OUT`) and Views 1–2 collapse D anyway.
2. **"Recurrence re-evaluation happens after any accept-and-retire outcome, including KEEP"** — **ambiguous/unsupported**. V1 draws it only from RETIRE, V2 from G; the two views do not agree on the source, and neither shows it for KEEP.
3. **"ASSESS and RESPOND are two sequential phases of one composed 'Error Handling' activity, joined only for blocking problems"** — **supported** (View 2 composition + blocking-only edge + V1's NOW gate).
4. **"HOLD/PENDING/OWNER ends are wait-states that resume when the owner responds"** — **unsupported** as drawn (plain ends, no resume edge).
5. **"The tolerate-class retry path is the fast path and is not subject to the blocking gate"** — **supported** as drawn (T→Yes bypasses C and NOW), though arguably a design smell rather than a drawing error.

## Confidence 0–5 with reasons

**3.**
- High (4–5) on structure: partition meanings, View-2-as-composition, View-3-as-drill-down, the stable-vs-incidental node split, and the textual (non-executable) nature of the correlation are all directly evidenced by labels and annotations.
- Low (2) on dynamics: recurrence sources conflict between V1 and V2, suspended-work ends lack re-entry semantics, the retry budget is undefined, and the actor/approval coverage in View 2 is partial. These are exactly the parts where the drawings under-determine behavior, and I flagged them as unknown rather than guessing.

STATUS: DONE
