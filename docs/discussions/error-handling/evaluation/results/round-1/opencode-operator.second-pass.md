# Second pass — differences after reading README.md and nodes.yaml

Only differences from `first-pass.md` are listed; everything else stands. Diagrams 1/2/3 in the stimulus are README Views 1/2/3, unchanged in content.

## Resolved unknowns / corrected readings

1. **Case 3 recurrence conflict — resolved.** README (View 2 note): "An unrelated new problem re-enters at Capture, while a recognized recurrence may resume review of the existing disposition." The two drawn paths are intentional and selective: a *recognized* recurrence goes back to **D · Decide disposition** (View 1 dashed edge), an *unrelated new* problem goes back through **A · Capture**. For Case 3 (known error returning), the D-direct re-evaluation path is the intended one. My first pass treated this as a contradiction; it is a designed distinction.

2. **"Within budget" — partially determined.** README (D/Decide note): "The existing #437 budget suggestion is one correction plus one review; there is no global recurrence counter or forced Zoom-out." The budget is roughly one correction plus one bounded review, not a counter I could not see. Still flagged as a *suggestion* in a discussion draft, not a drawn mechanism.

3. **Tolerate cap/escalation — clarified.** README (G/Accept note): "a Tolerate class records retry/escalation conditions but is **not claimed to be rooted out**." The "cap and escalation recorded" label means recorded retry/escalation *conditions*, and retirement of a tolerated item is explicitly not a claim of eradication — which is consistent with Case 3's re-evaluation requirement.

4. **View-2 linear C→D "inconsistency" — withdrawn as an inconsistency.** README states View 2 is "deliberately a structure/composition view, not a second executable flow specification". It was never meant to carry the early exits. My first pass flagged a contradiction; it is a granularity difference by design. (Related small correction: in the stimulus, Diagram 1's subgraph label "View 2 composition" means *these blocks correspond to View 2*, not that Diagram 1 is a rendering of View 2 — Diagram 1 is View 1 itself.)

5. **Case 1 retry mechanics — intent confirmed, mechanism still not drawn.** README: "an already-approved tolerate class can have a bounded per-operation retry (up to three); failure leaves that step UNVERIFIED and **does not convert mandatory evidence into PASS**". The bounded retry is intended; the missing loop edge remains a drawing simplification, and "does not convert mandatory evidence into PASS" confirms the UNV downgrade semantics I read conservatively. The retry path still shows no ledger write anywhere in README — my "unknown whether the occurrence is ledgered" stands.

6. **#359 / #394 — confirmed as existing mechanisms.** README: Existing Error Ledger (#359) and bounded context delivery (#394) "remain the established mechanisms; no new implementations are implied". Matches my inference; nothing new is being built.

7. **Document status — everything is a proposal.** README is a "discussion draft"; all seven actions in `nodes.yaml` have `status: proposed`. My refusal to assume working CLI commands, hooks, or runtime retry implementation was correct, and the README explicitly says "No implementation, CLI, governance policy, hook, or ledger behavior is changed" and "Do not expand the CLI/schema/governance surface before these diagrams are accepted."

## New information the diagrams could not show

- **Persistent identity**: `nodes.yaml` gives each action an immutable `identifier` (`ERR-YYYYMMDD-UUIDv4`), an independent `name`, and `status`. The A–G letters are drawing-local aliases, "NOT identity or ordered numbering", and decisions/early-exit nodes deliberately get no identities. My first pass read A–G as if they were the action names' identity; they are not.
- **Action responsibility table** (README): B Triage owns "whether main path is blocked"; C Identify owns "find/create its ledger record"; E Treat owns "define completion conditions, apply bounded response"; F delivers "only relevant lessons that are not already mechanically prevented"; G "observe[s] recurrences". These sharpen, but do not change, any branch I chose.
- **D vs E boundary**: "`Treat` owns the actual intervention and predeclared acceptance conditions; `Decide` does not silently implement fixes." Consistent with Case 4: an unapproved suspected-new class gets no treatment, by design.
- **Open questions acknowledged by the author**: "whether decision branches/early exits are located correctly" is listed as open for discussion — so my first-pass concerns about the redundant BLOCK gate and unreachable treatment path for a blocking-but-unapproved new class (Case 4) are recognized open points, not my misreadings.

## Still undetermined (unchanged from first pass)

- Whether a Case 1 retry failure writes to the ledger.
- Whether DEFER/HOLD/UNVERIFIED items are ever revisited — no re-entry mechanism is drawn or described ("conceptual return flow, not an automatic additional PR review round" only covers G's recurrence edge).
- What "continue independent work only" concretely permits.
- Whether the three attempts interact with a tolerate class's recorded cap.

## Confidence

Raised from **4** to **4.5**. The two-pass uncertainty that mattered most (which recurrence path applies) is resolved by an explicit README rule; budget and cap semantics are filled in; remaining deductions are items the author also marks open or does not address (post-DEFER/HOLD revisits, ledger-on-retry, "independent work" definition).

STATUS: DONE
