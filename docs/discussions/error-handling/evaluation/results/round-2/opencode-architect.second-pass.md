# Second pass — after reading parent README + nodes.yaml

Scope of this file: **only differences from `first-pass.md`**. First pass is unedited.

## Confirmations (first-pass readings the material supports)

1. **View roles.** My reading — View 1 authoritative control flow, View 2 composition/participants, View 3 drill-down of D — is confirmed and sharpened: the README explicitly forbids merging the views into one linear picture and calls View 2 "deliberately a structure/composition view, **not a second executable flow specification**". My lenient reading of View 2's loops as explanatory, not executable, was the intended one.
2. **Stable vs incidental nodes.** Confirmed: "Decisions are not additional persistent Actions" and "Ordinary start/end, decision diamonds and arrows do not receive document identities". My split of A–G (+ outcome actions) vs. T/REAL/KNOWN/.../RESULT as control-only was correct.
3. **Correlation is textual/logical, not executable.** Confirmed and refined: "No extra UML relation or `viewRef` field is introduced... the Action's existing name/identifier used for correlation." The persistent identities live **only in nodes.yaml** (seven `ERR-YYYYMMDD-UUIDv4` identifiers, status `proposed`); the diagrams intentionally show names, not UUIDs. My claim "nothing machine-readable links the views" needs one refinement: the machine-readable anchor exists, but outside the stimulus diagrams.
4. **Interpretation #1 (View 3 as standalone workflow) is unsupported** — as I marked it. README: View 3 "refines the D Action"; it is an "Action-detail **example**", and other Actions may later get their own Activity/Flowchart/Timeline. One nuance I missed: the author frames it as an *example* of how one Action is detailed, not as the normative D specification — slightly weaker than my "sub-activity drill-down" phrasing, same substance.
5. **Interpretation #5 (tolerate retry bypasses the blocking gate)** — supported; README's B/Triage note describes the bounded per-operation retry without mentioning the NOW gate.
6. **Interpretation #4 (HOLD/PENDING/OWNER ends are wait-states) remains unsupported** — the README adds nothing about re-entry for suspended items.

## Corrections (where the material changes my first pass)

1. **`R` retry semantics (first-pass unclear #1): resolved in intent.** README: "an already-approved tolerate class can have a bounded **per-operation** retry (up to three)". So the retry is of the failing operation, not a workflow step — my suspicion was misplaced. What remains open: the README also says "there is no global recurrence counter", so the counter scope (per occurrence vs. per class per recurrence) is still not defined.
2. **`MECH` "budget" (first-pass unknown): partially resolved.** README: the #437 budget suggestion is "one correction plus one review; no global recurrence counter or forced Zoom-out". Concrete enough to act on; whether diagrams should state it is a presentation gap, not an ambiguity of mine anymore.
3. **Recurrence loops (first-pass unclear #3): intent clarified, drawing conflict stands.** README (G note): "A later observation may trigger re-evaluation. This is **conceptual return flow**, not an automatic additional PR review round," and G's responsibility includes "observe recurrences". So the intended source is **G**, and View 1's edge from `RETIRE` only is a narrower drawing of the same intent. My "conflict between RETIRE (V1) and G (V2)" is thus an authoring inconsistency rather than a semantic disagreement — but as a *diagram-only* reader I could not have known that, so the first-pass flag was correct and the fix belongs in View 1 (or a note there).
4. **Missing G→INPUT loop in View 1 (first-pass unclear #4): intended behavior, not extra semantics.** README: "An unrelated new problem re-enters at Capture." It is deliberately shown only in View 2. My "lenient reading" was right about intent, but View 1 alone genuinely omits a behavior the author considers real — worth an explicit omission note in View 1, mirroring its note about early exits.
5. **`UNV` meaning (first-pass unknown): clarified at the boundary.** README: UNVERIFIED "does not convert mandatory evidence into PASS". Downstream lifecycle of a marked step remains out of scope of these views — still undetermined, now knowingly so.
6. **LEDGER/HOOK (first-pass unknown): declared existing.** #359 and #394 are "the established mechanisms; no new implementations are implied". I cannot verify their behavior from here, but their *status* (existing, reused, untouched) is now established rather than inferred.

## Remaining unresolved (unchanged from first pass)

- Re-entry semantics for `OWNER`, `HOLD`, `PENDING` (drawn as ends; README silent).
- Whether a `KEEP` (tolerate class active) outcome ever triggers re-evaluation — README's G note says "a later observation may trigger re-evaluation" generally, which slightly favors yes, but no view draws it from KEEP.
- `REVIEW -. approval .-> D` still under-covers `APPROVAL`/`TOLAPP`; README's responsibility table implies owner authority at B/C/D, but the drawn approval edge set is still partial.
- Retry counter scope (see Correction 1).
- Who "reviewer" is in `REAL` vs `REVIEW` — README merges them as "Reviewer / Owner"; my "presumably same actor" now has textual backing but remains an assumption about role separation.

## Revised confidence

**4** (was 3). Structural readings and the nature of the cross-view correlation were confirmed with little correction; the material resolves three of my unknowns (retry, budget, component status) and reframes two "conflicts" as authoring inconsistencies with known intent. One point withheld from 5: the View 1 recurrence edge (`RETIRE` only) and the missing View 1 re-entry loop remain real drawing defects a diagram-only reader must trip over, and hold-state re-entry is still unspecified anywhere.

STATUS: DONE
