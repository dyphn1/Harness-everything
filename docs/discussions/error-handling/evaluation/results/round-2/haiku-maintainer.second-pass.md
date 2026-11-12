# Second pass — differences from first pass (maintainer)

Sources read in this pass: `second-pass-material/README.md` (parent README) and `second-pass-material/nodes.yaml`. I did not open `activity.puml` or any other file in `second-pass-material/`, which the README links to; their existence is therefore unverified by me. `first-pass.md` is unchanged.

## Differences from the first pass

1. **Retry scope is resolved.** First pass called `Retry this operation (max 3)` unclear. README: a bounded per-operation retry, up to three, for an already-approved tolerate class; failure leaves that step UNVERIFIED and does not turn mandatory evidence into PASS. My first-pass inference that retry is for "transient" operations is not supported by the README; drop it.
2. **Tolerate wording conflicts.** First pass listed "cap and escalation recorded" as drawn. README says a Tolerate class records **retry/escalation conditions**, not a cap. The diagram label ("cap") and the README wording disagree; flag this, do not pick one.
3. **Converge/Avoid inference was wrong.** First pass said Converge and Avoid "remove the need for further treatment". All three dispositions (Converge, Avoid, Tolerate) go to E · Treat in the diagram, and README D says Converge/Avoid are accepted against defined conditions. Treat always runs.
4. **Ledger and #394 are asserted as established.** First pass said their existence was unknown. README says the Error Ledger #359 and bounded context delivery #394 "remain the established mechanisms; no new implementations are implied". This is the README's claim, not something the diagrams establish. I still cannot verify it from the material.
5. **Ledger writes.** README C: reuse the existing class when present; creating an unknown class needs owner approval; "recording an occurrence is not a new ledger". This clarifies that C writes to the existing ledger, but nothing says E writes to it. My first-pass "visual only" note stands for E.
6. **Reviewer judgement location.** README places the reviewer's "is this real" decision in B · Triage, which matches View 2's dotted link from Reviewer to B. My first-pass concern (View 1 draws it after B inside ASSESS, View 2 attaches it to B) is consistent; README confirms the intent.
7. **D budget is defined outside the drawings.** `within budget` is drawn as a decision but the budget is defined only in the README: one correction plus one review; no global recurrence counter; no forced Zoom-out. First pass could not know this.
8. **View 3 inputs and outputs.** README: inputs are identified error class, evidence, current step and budget; output is the treatment direction (Converge / Avoid / owner-approved Tolerate) or an unresolved decision. D does not implement fixes; E owns intervention and acceptance conditions. First pass had none of this.
9. **Deferred items.** README: a non-blocking item is recorded, then deferred, and "does not open an immediate fix cycle". This confirms deferral is deliberate. There is still no drawn revisit path, so the open point stands.
10. **Re-entry and recurrence.** README: an unrelated new problem re-enters at Capture; a recognised recurrence "may resume review of the existing disposition", and this is not an automatic extra PR review round. First pass read the dotted edges as possibly control or information flow. README calls them explanatory associations, not new edge types.
11. **Identifier format.** README gives `ERR-YYYYMMDD-UUIDv4` with "category at creation / creation date / UUID" in parentheses. The nodes.yaml identifiers have no category segment, only the `ERR-` prefix. Ambiguous; the parenthetical may describe the prefix, but this is not stated.

## Answers to the second-pass questions

**`identifier`, `name`, `status` responsibilities** (from README and nodes.yaml):

| Field | Responsibility | nodes.yaml value (example, D) |
|---|---|---|
| `identifier` | Persistent identity; immutable once accepted; GUID gives collision resistance, date and category are descriptive only | `ERR-20261112-cd6a0fd5-d354-4bcb-8d34-71fcc985e5e4` |
| `name` | Human/agent-readable meaning; can change without changing identity | `Decide disposition` |
| `status` | Separate metadata; `proposed` in this draft, no lifecycle transition specified | `proposed` |

Drawing letters A–G are drawing-local aliases, not identity and not ordering. nodes.yaml states this in its own header, as does the README.

**Do the diagrams imply files already exist for each Action?** No. The diagrams show no file paths, artifacts or stores. nodes.yaml is a "discussion prototype; not a production schema". The README says each Action "may later be detailed" by its own diagram, which is future work, not existing files. The README's `activity.puml` link is a file reference I have not verified.

**Which links are visual only, not physical?**
- Visual (per README and View 2): all dotted links in View 2 (Reviewer/Owner → B and D; Ledger → C and E; HOOK → F; G → INPUT and G → D). They are "explanatory associations, not new graph edge types".
- Cross-view correspondences are not links at all. The «expanded in View 3» marker is text, and the README says no `viewRef` or UML relation is introduced. Correlation is by name or identifier.
- Physical in the sense of control flow: only the solid arrows in View 1 (and the composition-level solid arrows in View 2, which the README calls structure, not flow).

**Detail-view lookup and renaming (revised).** My first pass said the stable details were the drawing letter, marker text and outcome names. The README changes this: the stable key is the **identifier** (`ERR-…`), since correlation uses "the Action's existing name/identifier". The letter D is drawing-local and not stable. If D is renamed, its `name` field and the text in the marker «expanded in View 3» and the View 3 subgraph title must change together, but the identifier stays. If D is moved to another region, the README's grouping is "organizational and do not change control flow", so only the ASSESS/RESPOND membership changes; View 3 still expands the identified Action. Both points are the README's, not my inference.

## Confidence after second pass

**3 / 5 (unchanged).** The README resolves retry scope, the D budget, the View 3 inputs/outputs and the ledger status claim, and clarifies the dotted links. It does not resolve the tolerate cap/conditions conflict, E's ledger writes, the deferred revisit path, the `continue independent work` label, or the existence of the Ledger and #394 mechanisms (asserted, not shown). It also introduces a possible mismatch in the identifier format description.

STATUS: DONE
