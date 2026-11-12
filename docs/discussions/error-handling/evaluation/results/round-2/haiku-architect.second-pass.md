# Second pass: differences from first pass only

Read after `first-pass.md` was written: `second-pass-material/README.md` (parent README) and `second-pass-material/nodes.yaml`. `first-pass.md` is unchanged.

## Corrected

1. **"Action leaves" was wrong.** First pass listed Retry, Dismiss, Record occurrence, Define class and similar nodes as action leaves. The parent README says "Decisions are not additional persistent Actions", and `nodes.yaml` defines exactly seven Actions (A–G). Those leaves are steps or outcomes inside the Actions, not Actions. Converge, Avoid and Tolerate are D's outcomes, not Actions.
2. **Dotted edges in Diagram 2 are not control flow.** README (View 2): "Dotted lines are explanatory associations, not new graph edge types." My first-pass item 1 treated `G -. recurrence .-> D` as a control-flow contradiction of the `C -->|blocking only| D` gate. Against the README, that is an association, not a flow edge. The point still stands as a reading risk: a reader will take it as flow, because the gate is drawn solid and the recurrence line sits right next to it.
3. **Item 14 (Diagram 3 PENDING sink) is not a defect.** README View 3 says output is "selected treatment direction … or unresolved decision". PENDING as a sink matches that intent. The only difference is that Diagram 3 has no Start and End, which the README says is by design (it is an Action-detail example).

## Now resolved by the parent README (was "could not determine")

4. **#359 and #394** are the Existing Error Ledger and the bounded context delivery, both "established mechanisms; no new implementations are implied". Their internals are still unknown.
5. **"budget"** (D3 input, D1 "within budget") is the existing #437 budget: "one correction plus one review; there is no global recurrence counter or forced Zoom-out." This is outside the diagrams, but it settles the meaning. It also means the "Retry (max 3)" bound is a per-operation retry, not a loop (README B / Triage).
6. **"define acceptance first" (E)** means "define completion conditions, apply bounded response" (README Action table) and "predeclared acceptance conditions" (README View 3).
7. **Converge/Avoid/Tolerate "cap" and escalation**: README G says Tolerate "records retry/escalation conditions but is not claimed to be rooted out."
8. **Owner and reviewer roles**: README View 2 calls it "owner/reviewer authority". The README places owner approval at two points: creating an unknown class (C) and approving a tolerate class (D). Still not stated whether owner and reviewer are one person.

## Confirmed by the parent README

9. **Diagram 3 is a sub-activity** of D, expanded for an Action-detail example. README: "not a replacement for View 1".
10. **ASSESS / RESPOND are organizational groupings** that "do not change control flow". My first-pass inference was that they are the classify/gate and act stages. The README agrees in effect, and adds that they are for organization only.
11. **Blocking-only route** `C → D` and `NOW → D`: README says "A non-blocking item is identified/recorded, then deferred; it does not open an immediate fix cycle." Matches.
12. **Held items** remain unresolved by design, but the README gives no re-entry path either. "Owner decides" appears in Triage and Identify, not as a returning edge. My item 5 stands.
13. **Ledger usage**: C "find/create its ledger record" and "Recording an occurrence is not a new ledger". Matches the D1 OCC/DEF edges. The E-to-LEDGER arrow in D2 (mechanism/disposition) is not explained in the README, so it stays "unclear".

## Newly visible in the README (not in the drawings)

14. **Stated intent of View 1** is "Actions, guards, early exits, branches, recurrence and return paths." Measured against that, D1 does not show the required return path for an unrelated new problem (D2 shows `G → INPUT → A`; D1 has no such edge). This is a drawing gap, not only a reading ambiguity.
15. **Tolerate return path**: README G says "a later observation may trigger re-evaluation" of Tolerate. D1 draws no edge from KEEP to any re-evaluation point (only to End). So item 3 is stronger: the intended return is absent from the drawing.
16. **Recurrence wording differs**: D2 says "resume review of the existing disposition"; D1 says "re-evaluate disposition" at D. Same target, different verbs; both are "re-entry at D".
17. **Identity**: `nodes.yaml` gives each A–G an `identifier` (`ERR-YYYYMMDD-UUIDv4`), a `name`, and `status: proposed`. The drawings carry names and local letters only, and the yaml says A–G are "NOT identity or ordered numbering". So the drawing-to-Action correlation is textual (by name) and nothing in the drawings is executable.
18. **"Not an executable link"** is confirmed: README "No extra UML relation or `viewRef` field is introduced" and "not a production schema".

## Updated interpretation checks

| Check | First pass | Second pass |
|---|---|---|
| Diagram 3 sub-activity | Supported | Supported, confirmed by README |
| ASSESS / RESPOND meaning | Supported by content | Supported; README: organizational only |
| Stable Actions vs control | A–G plus many leaves | Only A–G are Actions; everything else is control or outcome (corrected) |
| Correlation type | Textual; executable unsupported | Textual by name; yaml identifiers are not in the drawings; executable unsupported (confirmed) |
| Recurrence routing | Ambiguous | Ambiguous, but the README's intent (`G → D` on recurrence, `G → INPUT` on new problem) makes the D1 gap a defect |
| I3 (blocking gate applies to recurrences) | Unsupported | Unsupported as flow; dotted edges are explanatory per README (weakened) |
| I4 (owner decision re-enters) | Unsupported | Unsupported, no README return path either |
| I6 (tolerate recurrence via ASSESS retry) | Ambiguous | Partly resolved: README says Tolerate is re-evaluated on later observation; D1 routes it to ASSESS retry, not D. Still a mismatch. |

## Confidence after the second pass

**3 → 3.** Several terms are now defined by the parent README (budget, #359/#394, acceptance conditions). The drawing-level defects I listed are still there, and the README confirms at least two of them as intent gaps: the new-problem return path and the Tolerate re-evaluation path are both absent from Diagram 1. That keeps the reading at 3 rather than higher, because the drawings alone still cannot show these.

STATUS: DONE
