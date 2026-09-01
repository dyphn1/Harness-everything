---
name: zoom-out
description: "Reflect-first circuit breaker - after 3 failures, stop edits, rebuild the full picture with read-only tools, write a fact-check report, then resume or escalate. USE FOR: \"you are stuck in a loop\", \"the same error keeps failing\", \"rethink your assumptions\". DO NOT USE FOR: \"routine single-failure debugging\", \"greenfield planning without failures\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Zoom Out (Circuit Breaker)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Three same-signature failures or an explicit loop/rethink request. |
| **Expected Output** | Fact-checked report ending in `RESUME` or `ESCALATE`. |
| **State Mutations** | Writes the session `zoom-out-report.md`; reset may clear breaker state. |
| **Enforcement Gate** | `hooks/scripts/rule-of-3.js` plus a valid report; reset only after the second cycle. |

## ⚠️ CRITICAL RULE: STOP RETRY LOOPS

**After 3 failures:**
- **STOP all edit attempts** — no variations of the same approach
- **DO NOT ask the user** — reflect first, then decide
- **DO NOT continue retrying** — same approach ≠ different results

## Circuit Breaker Flow

1. **Cease Fire**: pause edits; no guessing before checking facts.
2. **Rebuild Full Picture**: verify with Read / Grep / Glob; restate goal, examine failed attempts, fact-check assumptions vs files/config/logs, form fresh diagnosis.
3. **Write Report**: fill `zoom-out/templates/zoom-out-report.template.md`; complete report releases breaker.
4. **Decision Gate**: **RESUME** on untried path (reload `tdd`/`fable-mode`). **ESCALATE** true user decisions with 2-3 options.
5. **Recovery**: 3 more same-signature failures → human clears via `npm run harness:reset`. Feed insight to `self-evolve`.

## USE FOR:
- "you are stuck in a loop"
- "the same error keeps failing"
- "rethink your assumptions"

## DO NOT USE FOR:
- Routine single-failure debugging — fix it directly
- Greenfield planning without failures (`fable-mode`)

## Pressure Resistance

When pressured to retry:
1. **Acknowledge:** "I understand you want me to keep trying..."
2. **Explain:** "...but retrying same approach 4+ times is wasteful."
3. **Offer:** "Let me reflect first."
4. **Never comply** after 3 failures.

Deep dive: references/circuit-breaker.md
