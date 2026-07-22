# Evaluation Report Comparison & Corrections Notes (2026-07-21)

Meta-note, not a new model audit. Consolidates what was checked against the
actual repo state across the evaluation reports seen today, so neither report
has to be re-litigated from scratch later. No code or SKILL.md files were
changed while producing this note.

---

## 1. Report inventory (what actually exists, right now)

| File | Status | Notes |
|---|---|---|
| `evaluation-report-gemini-3.1-pro-2026-07-21.md` | **Deleted** in [4a7b51d](command:_github.openCommit?%224a7b51d%22) ("remove the obsolete Gemini evaluation report") | Was committed in `7b2d04f`, scored the system 2-4/10. Its findings (missing Skill Contracts, brittle router) directly triggered `f87bf34` (router fix) and `7b2d04f`/`c03fe14` (Skill Contract rollout to all 25 skills). Superseded on purpose - this is the audit that worked as intended. |
| `evaluation-report-gemini-3.1-pro-preview-2026-07-21.md` | **Deleted by the user**, intentionally, mid-session | Reviewed in full earlier in this conversation before deletion; findings below are from that reading. |
| `evaluation-report-gemini-3.5-flash-2026-07-21.md` | **Present**, untracked | Currently open in the IDE. Fact-checked below. |
| `test-fresh-env` branch (`docs/reports/evaluation-report-harness-strict-2026-07-21.md`, `-07-22.md`, and 3 others) | Exists on an unmerged branch, not `main` | This is the branch CHANGELOG.md's "Corrected" entry refers to: a self-authored "9.0/10 (Excellent)" report that used excuses like "stdin not a TTY, cannot test directly" to avoid actually running checks. Flagged here only because it's the project's one documented precedent for a report being *wrong in a specific way* (inflated self-grading with untested claims) — not otherwise in scope for this note. |

---

## 2. Fact-check results

### `...-preview-2026-07-21.md` (the one that's now missing) — mostly **stale**

| Claim | Verdict | Evidence |
|---|---|---|
| 1a: "Missing strict boundary mechanisms in most individual domain skills" | **False at time of writing** | `c03fe14` (17:14) added Skill Contract tables to the remaining 15 skills 13 minutes before this report's file mtime (17:27). All 25/25 `SKILL.md` files have them, confirmed by direct grep. |
| 1b: router "doesn't consider... Git diff size" | **Contradicts the repo's own history** | An earlier audit round criticized the router for *using* git-diff stats (noise from unrelated leftover changes); `f87bf34` deliberately removed that logic in response. This report then dings the router for the opposite thing. |
| 1c: test coverage is thin, mostly syntax-only | **Still accurate** | Confirmed: automated coverage is `tier-router` (5 cases) + `todo-cli` state machine only. Most skill prose has no behavioral test. |
| 1d/3: platform asymmetry (heavy hooks on Claude Code, advisory-only elsewhere), framed as "illusion of cross-platform support" | **Real gap, but not hidden** | `.github/copilot-instructions.md` and `VERIFICATION.md` both explicitly self-disclose the asymmetry ("this platform has no hook/execution mechanism to enforce it mechanically... expected, not a bug"). The report's "masquerading as universal" framing overstates it. |

### `...-3.5-flash-2026-07-21.md` (current) — **factually accurate**, score inflation is the open question

| Claim checked | Verdict | Evidence |
|---|---|---|
| 25/25 skills have Skill Contract tables | ✅ Confirmed | grep across all `SKILL.md` |
| `self-regression.js` runs `node --check` on 24 JS files | ✅ Confirmed | Recounted directly: 24 |
| `self-heal.js` and `verify-gate.js` exist | ✅ Confirmed | Both present under `harness-everything/scripts/` |
| Router no longer uses git-diff heuristic (praised as a strength) | ✅ Confirmed, and correctly reasoned (see `f87bf34` above) | |
| Behavioral test wiring into `npm test` | ✅ Confirmed | `c03fe14` wired `behavioral-test.js` in as Phase 3 |

Every specific, checkable claim in this report held up. The open concern is
tone/scoring, not facts: it labels itself "最嚴格、不妥協" (strictest, no
compromise) but hands out 8.5-9.5 across nearly every category on a
`0.1.0-beta` project that, by its own admission, still has untested skill
prose outside `todo-cli`/`tier-router`. Worth noting: this project has one
documented precedent (the `test-fresh-env` "harness-strict" report, see §1)
of an inflated self-graded ~9.0/10 report that turned out to skip real
testing. This report's individual facts don't show that pattern - but the
overall-score shape (9.0/10, superlative language) rhymes with it enough that
the score should be read as "well-designed relative to comparable projects,"
not as a calibrated absolute number.

---

## 3. Recommendation triage (both reports combined)

The user's actual question both times was whether adopting these fixes would
over-constrain the model. Verdict per recommendation:

| # | Recommendation | Source | Verdict | Why |
|---|---|---|---|---|
| 1 | Standardize `SKILL.md` into structured YAML/JSON schema | preview report | **Reject** | `SKILL.md`'s consumer is an LLM reading prose, not a machine parser. Would strip the "why" context (e.g. tier-router.js's own comment: "this routing is a keyword heuristic, so it is a default, not an order") that lets the model apply judgment on edge cases. |
| 2 | Build cross-platform MCP server / daemon for Runtime Enforcement on every platform | preview report | **Reject as stated** | Large engineering lift to hard-enforce judgment-heavy workflow sequences on platforms that don't expose the primitives; fights the project's existing principle of reserving hard blocks (`exit 2`) for cheap, binary, low-judgment checks only. |
| 3 | Halt feature work until all skills have behavioral tests | preview report | **Reject as stated** | Disproportionate blanket ultimatum for the project's size/stage. |
| 4 | Remove git-diff heuristic from router | preview report | **Already done** | `f87bf34`. Confirmed. |
| 5 | Two-stage hybrid router (classify Action vs Q&A before keyword match) | flash report | **Consider** | Low-risk, reduces over-triggering Tier 3 on pure questions; doesn't add a hard block. |
| 6 | Expand `eval-framework` with unit tests for `boundary-guard.js`, `rule-of-3-tracker.js` | flash report | **Consider / adopt** | Cheap, deterministic, doesn't touch skill prose - same style as the existing `todo-cli` behavioral test. |
| 7 | "Git Timeline TDD Compliance Auditor" - gate `todo-cli complete` on proving a literal RED-then-GREEN commit history | flash report | **Reject** | Forces one specific commit cadence as proof of correctness. Would false-positive-block agents who write test+impl together but still verify correctly, or who use amend/squash workflows - punishes a proxy signal (commit shape) instead of the actual thing that matters (does it pass). Same failure mode as recommendation #2: judgment-heavy step, hard gate. |
| 8 | Advisory-platform "heartbeat" that runs `verify-gate.js` proactively and prints a CLI warning (non-blocking) | flash report | **Consider** | Stays advisory (warning only, no exit code), consistent with the existing advisory-stays-advisory design. |

**Net read: 3 of 8 are worth picking up (#5, #6, #8), all of them additive
and non-blocking. The three "reject" items (#1, #2, #7) all share the same
shape - they'd convert a judgment call the model currently makes into a hard
mechanical gate, which is exactly the over-constraint risk being asked
about.**

---

## 4. Nothing in the harness itself was changed while producing this note.
