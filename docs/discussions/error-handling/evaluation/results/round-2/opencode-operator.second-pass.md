# Second pass — differences from first pass only

Stimulus added: parent README (three-view discussion draft) + `nodes.yaml` (action identity prototype). The diagram sources in the README are byte-identical to the frozen diagrams I reviewed, so my diagram-to-diagram mapping stands unchanged. Below are only the differences the new material makes.

## Differences in my overall reading

1. **Intent confirmed as conceptual, not executable.** The README states explicitly this is a discussion draft changing no implementation, CLI, hooks, or ledger behavior. My first-pass stance ("decision logic only; do not assume working mechanisms") was correct and is now the author's stated position, not just my caution.
2. **A–G identity clarified.** I treated A–G as drawing-local aliases; the README/nodes.yaml confirm this and add that seven persistent proposed identities exist (`ERR-YYYYMMDD-UUIDv4`), correlated **by name, not by the yaml key letter** ("A–G are drawing-local aliases, NOT identity or ordered numbering"). My mapping was name-based, so it survives; but I would now stop short of assuming yaml key `A` ↔ drawing alias `A` as identifiers — the names match, the letters do not carry identity.
3. **"max 3" partially resolved.** Reading note: "bounded per-operation retry (up to three)". Still ambiguous whether the initial attempt counts, but it is confirmed per-operation, not global.
4. **RECHECK's "bounded review" partially resolved.** The #437 budget suggestion is "one correction plus one review; no global recurrence counter or forced Zoom-out". My first-pass complaint that the bounded review is not a drawn node stands, but its intended scope is now stated.
5. **RESULT "cap and escalation recorded" partially resolved.** G's note says a Tolerate class "records retry/escalation conditions but is not claimed to be rooted out" — recording is confirmed as part of the Tolerate/G outcome, though the diagram still doesn't show where.
6. **Case 1 outcome sharpened.** Triage note: failure "leaves that step UNVERIFIED and does not convert mandatory evidence into PASS". This confirms and strengthens my reading that recovery/success cannot be declared — it is now explicit that the UNVERIFIED state cannot be papered over.

## Differences per case (first-pass numbering)

- **Case 1 (tolerated transient, 3 attempts failed):** No change to the branch (T|Yes → R → REC|No → UNV). New material confirms the UNVERIFIED/not-PASS semantics but still provides no resumption path for the interrupted work. My "tolerate branch skips the blocking check" concern remains unaddressed and is implicitly covered by the README's open question "whether decision branches/early exits are located correctly".
- **Case 2 (non-blocking real defect):** Reading note confirms my reading verbatim: "A non-blocking item is identified/recorded, then deferred; it does not open an immediate fix cycle." The absence of a return path for deferred items is still not addressed — my concern stands, also within the "open for discussion" list only as branch placement.
- **Case 3 (known blocking error recurs):** Confirmed: "a recognized recurrence may resume review of the existing disposition" (View 2 note) and "A later observation may trigger re-evaluation. This is conceptual return flow, not an automatic additional PR review round." Two consequences: (a) my reading of re-entry at D (not A/B/C) is confirmed as intent; (b) my first-pass caution that the recurrence path bypasses ledger recording is **not** resolved — no record edge is added, and the README doesn't claim one. The RETIRE-vs-G anchoring inconsistency between Views 1 and 2 also remains, since the README reproduces both diagrams verbatim.
- **Case 4 (suspected new class, no owner approval):** No change. HOLD remains a dead end with no on-approval resumption edge, and the blocking-but-unapproved gap (no route to D) is not addressed; it falls under the same open "branches located correctly" question.

## Differences in "unclear or potentially misleading"

- My items 1–8 remain; none is contradicted. Item 5 (max 3) and items 7 (bounded review scope) and 8 (cap/escalation recording) are now partially answered by reading notes, as above. Item 9 (ledger/delivery as black-box assets) is confirmed: the README says #359 and #394 "remain the established mechanisms; no new implementations are implied".
- New minor point: the README's own boundary table gives B Triage the responsibility of judging "whether main path is blocked", which the View 1 tolerate-class branch never exercises — the text and the drawn flow disagree slightly more clearly now that the table makes the intent explicit.

## Differences in "what I could not determine"

- Now determinable: the seven actions' proposed persistent identities and that status is `proposed` with no lifecycle spec yet (nodes.yaml); the budget suggestion behind RECHECK; the explicitly-discussed (not implemented) nature of everything.
- Still not determinable: ledger record schema (nodes.yaml is only an action-identity prototype, not a ledger schema); owner/reviewer concrete workflow; resumption of UNVERIFIED or deferred or held items; how approvals arrive and are acted upon.

## Confidence

**4 / 5** (was 3). The new material confirms my structural reading and the four branch choices, and confirms the diagrams are deliberately non-executable, which validates most of my "cannot declare" answers. It does not resolve the dead-end/outcome gaps (UNV, HOLD, PENDING, DEFER continuations, recurrence recording, blocking-unapproved-class route) — those stay genuinely open in the draft itself, which is why I do not go to 5.

STATUS: DONE
