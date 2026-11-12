# Second pass — differences from first pass

Read after `first-pass.md` was written: `README.md`, `nodes.yaml`. The first pass is not edited. Everything below is **source-traced** (read from the diagram text and the README/nodes.yaml text). Nothing was executed, and I did not verify that any mechanism exists.

## Corrections to the first pass

1. **"No view is authoritative" was wrong.** README says View 1 is the full decision process, View 2 is "not a second executable flow specification", and View 3 refines only D. So View 1 governs flow. Read this way, the first-pass conflicts are about how a reader may misread View 2 and View 3 arrows as flow, not about which flow is correct.
2. **Point 13 (Diagram 3 omits the gate) is downgraded to minor.** D3 refines D, and the NOW gate sits upstream of D. The remaining risk is that D3's input node is labelled `C · Identify` and points straight at `Q`, which reads as a direct C → D link.
3. **Owner-approval row was imprecise.** The owner appears as diamonds in Diagram 1 (REAL=Unclear, APPROVAL, TOLAPP) and as dashed associations in Diagram 2 (into B and D). Intent is consistent; the form differs.

## Reframed by README (point numbers refer to `first-pass.md`)

- **Point 2 (non-blocking items reach D):** README says "A non-blocking item is identified/recorded, then deferred." So Diagram 1 matches the intended flow. Diagram 2's `C --> D` and Diagram 3's `IN → Q` contradict it *as drawn*. This is a view-readability defect, not a flow defect.
- **Point 3 (recurrence target), now sharper:** README says "An unrelated new problem re-enters at Capture, while a recognized recurrence may resume review of the existing disposition."
  - Diagram 1 `RETIRE -.-> D` matches the recurrence rule.
  - Diagram 2 `G -.-> INPUT` is labelled "newly observed recurrence" but points at the new-problem entry (INPUT → A). The label and the target disagree with each other and with README. **Source-traced conflict.**
  - Still valid: Diagram 1's retire edge skips `KNOWN` (C). README makes "recognized" the condition for the shortcut, and the drawing does not enforce it. A mis-recognised new signature (S2) would reach D with no `APPROVAL` gate. Counterexample stands.
- **Point 5 (retry "max 3", no counter):** README says "bounded per-operation retry (up to three)" and "there is no global recurrence counter". So per-operation scope and the lack of a global counter are intended. "Up to three" is still ambiguous (retries or attempts). Cross-operation escalation is a design risk, not a drawing defect.
- **Point 4 (Avoid retires a recurring class):** README says Converge or Avoid "can be accepted against defined conditions" and G should "retire lessons that are no longer required". So retiring after Avoid is intended. Whether Avoid retires when `RECHECK=Yes` was observed is still not stated. Remains **unclear**.
- **Point 12 (undefined terms):**
  - "budget" is defined only by reference: README line 93 says "the existing #437 budget suggestion is one correction plus one review". A reader of the diagrams alone cannot recover it.
  - "met" maps to "defined conditions" / "predeclared acceptance conditions" (README E and G text).
  - "bounded review", "restricted", "required checks" and "cap" remain undefined in both the diagrams and README.

## New conflict from README against Diagram 1 (strongest finding in this pass)

- **[D + README] Approved-tolerate branch skips a duty assigned to Triage.** README's responsibilities table says B Triage must "Judge real issue, permitted tolerance **and whether main path is blocked**". In Diagram 1 the blocking check (`BLOCK`) sits only on the non-tolerate branch (`T=No → REAL=Yes → BLOCK`). The `T=Yes → Retry` branch never asks whether the main path is blocked.
  - Counterexample: class X is approved as tolerate. A new occurrence blocks the main path. Retry fails three times → `UNV` → "continue independent work only" → End. Nothing records that the blocking path was affected.
  - Expected by README: Triage judges blocking for every finding.
  - Actual in the drawing: only for non-tolerate findings.
  - Consequence: a blocking occurrence of a tolerated class can pass unrecorded and without owner notice.

## Still open after README (from first pass, no change)

- **Point 1** (`BLOCK` diamond does nothing): README does not mention it. Stands.
- **Point 6** (recovered retry leaves no ledger trace): README is silent on recording retry success. Stands. The cap in "Tolerate: cap and escalation recorded" cannot trip without a count.
- **Point 8** (held blocking item and the main path): README confirms the gate ("creating an unknown class requires owner approval"; "an unclear item goes to the owner"). It does not say whether the main path halts while held. Still **unclear**.
- **Point 9** (no re-entry for pending/held/open states): README is silent. Stands.
- **Point 10** (two "tolerate" questions): README uses the same two phrasings ("approved tolerate" in B; "owner approves tolerate class" in D). Stands.
- **Point 11** ("Existing" labels): README line 123 calls the Error Ledger (#359) and bounded delivery (#394) "established mechanisms". That is a README claim. I did not verify it (no git, no network, and the packet limits me to this directory), so it stays **unverified**.
- **Point 14** (wording of PENDING vs WAIT): stands.

## New from nodes.yaml

- nodes.yaml defines seven Actions, each with `status: proposed`, and no other state. There is no persisted state for held, pending, waiting, unverified, deferred or open. README says "Decisions are not additional persistent Actions." So an item held by the owner or left UNVERIFIED has no recorded state in the identity model. This makes the "held reads as terminal" risk (point 8) concrete: a reader checking nodes.yaml cannot find a status for it. **Source-traced.**
- nodes.yaml says "A-G are drawing-local aliases, NOT identity or ordered numbering." The diagrams label A–G in alphabetical flow order, so a reader may take the letters as sequence. Minor. A diagram-only reader cannot see the header comment.

## Other README notes

- README line 90 states the primary blocking path as "exactly" Capture → Triage → Identify → Decide → Treat → Deliver → Accept. That is a summary, not Diagram 1's branch structure (KNOWN, APPROVAL and NOW are omitted from it). Not a contradiction, but a reader who uses README's line as the spec would miss those gates.
- README line 174 says the author is open on "whether decision branches/early exits are located correctly". That matches the early-exit points I raised (HOLD, DISMISS, PENDING, WAIT), so these are on the author's own list.

## Updated confidence

**3** (unchanged from first pass).
- README resolves several first-pass questions by intent: per-operation retry, no global counter, the budget reference, and View 2 not being a flow spec.
- It also adds a sharper finding (the approved-tolerate branch skips blocking judgment that README assigns to Triage) and a mislabelled recurrence edge in Diagram 2.
- Net: fewer ambiguous points, more concrete conflicts. Still no executed evidence; every finding is source-traced.

STATUS: DONE
