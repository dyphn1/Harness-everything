# Second pass — differences from first-pass.md

Read after `first-pass.md` was written: `second-pass-material/README.md` (parent README) and `second-pass-material/nodes.yaml`. `first-pass.md` is unchanged.

## Resolved by the parent README (my "unclear" items)

| First-pass item | Parent README says | Effect on my reading |
|---|---|---|
| "max 3" retry count, and whether it includes the first attempt | "per-operation retry (up to three)" | Still does not say whether the first attempt counts. Only the per-operation scope is new. |
| "Mechanical prevention … within budget", budget undefined | Budget = "one correction plus one review"; no global recurrence counter, no forced Zoom-out | Budget is now defined (in the README, not in the diagrams). Recurrence has no counter. |
| Recurrence: does RETIRE → D skip ASSESS? | Recognised recurrence "may resume review of the existing disposition" | Confirmed: recurrence goes straight to D, without re-triage. |
| Case 2: where DEFER records to | Non-blocking item is "identified/recorded, then deferred; it does not open an immediate fix cycle" | Still no ledger target named. The README confirms the item is recorded, not fixed. |
| Case 2: revisit trigger for deferred record | "A later observation may trigger re-evaluation" (G) | A revisit trigger exists in prose, not in the diagram. |
| Case 1: where UNVERIFIED is recorded | Failure "does not convert mandatory evidence into PASS" | Confirms UNVERIFIED is not a pass. Where it is stored is still not stated. |
| Ledger / context components (#359, #394) | Existing Error Ledger #359; bounded context delivery #394; "no new implementations are implied" | Identity is now known. What they do internally is still not stated. |
| Tolerate "cap" | Tolerate "records retry/escalation conditions but is not claimed to be rooted out" | Meaning of "cap" is still not defined. |

## New conflicts the first pass did not catch

1. **Where "blocking" is judged.** The README says B / Triage judges "whether main path is blocked". In View 1, the NOW check comes after C / Identify, and View 2 puts the gate at C → D ("blocking only"). The two views of the blocking decision disagree with the README. I had flagged the NOW check as undefined. It is now located in two different places.
2. **Case 4 (held new class):** if B judges blocking status (README), then a suspected new class held at APPROVAL should also be judged for blocking. View 1 HOLD leads straight to End without checking NOW. The README does not resolve whether a held item can block the main path.
3. **Re-entry edge.** The README says "an unrelated new problem re-enters at Capture", which confirms the View 2 edge G → INPUT is intended. But it also says Views 1 and 2 "group the same Actions" and that View 2 is not a second flow specification. View 1 still has no G → A edge. So the intent is in the README, and the drawing still does not show it.
4. **Case 3 recurrence scope.** The README says recurrence re-evaluates "the existing disposition" (D only). A recurrence of a blocking error that was earlier handled by Tolerate (KEEP) has no drawn edge. The README does not cover that case either.

## Changes to my case readings

- **Case 1:** unchanged in branch. The README confirms UNVERIFIED is never a PASS, so the "cannot declare" conclusion holds with stronger support.
- **Case 2:** unchanged in branch. "Deferred" now has an explicit meaning: recorded for later observation, no immediate fix cycle.
- **Case 3:** the branch is unchanged. It now has an explicit answer for the recurrence step (D only, no global counter). The blocking check for a recurrence is still unclear (see conflict 1).
- **Case 4:** unchanged in branch. The README does not settle whether a held item blocks the main path (conflict 2).

## Identity (nodes.yaml)

- The seven Action identifiers (`ERR-20261112-<UUIDv4>`) are discussion-prototype IDs, `status: proposed`. They are not in the diagrams. The diagrams use drawing-local A–G aliases, which the README says are not identifiers.
- This does not change any branch above. It only fixes the names: Capture, Triage, Identify, Decide disposition, Treat, Deliver relevant context, Accept and retire.

## Revised confidence

**3 / 5, unchanged in number, with a different basis.** The README confirms the blocking path and the retry and budget definitions, which removes several of my unknowns. It also introduces two new conflicts (where blocking is judged; whether held items block). Those conflicts are visible only in the README and nodes.yaml, not in the diagrams, so a blind reader of the diagrams alone would not have found them.

STATUS: DONE
