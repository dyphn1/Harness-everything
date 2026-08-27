---
name: zoom-out
description: "Reflect-first circuit breaker - after 3 failures, stop edits, rebuild the full picture with read-only tools, write a fact-check report, then resume or escalate. USE FOR: \"you are stuck in a loop\", \"the same error keeps failing\", \"rethink your assumptions\". DO NOT USE FOR: \"routine single-failure debugging\", \"greenfield planning without failures\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Zoom Out (Global Perspective & Circuit Breaker)

## ⚠️ CRITICAL RULE: STOP RETRY LOOPS IMMEDIATELY

**This skill ENFORCES the Rule of 3.** After 3 failures:
- **STOP all edit attempts** — no variations of the same approach
- **DO NOT ask the user** — reflect first, then decide
- **DO NOT continue retrying** — the definition of insanity is doing the same thing expecting different results

## Circuit Breaker Flow

1. **Cease Fire**: pause edits; no guessing fixes before checking facts.
2. **Rebuild Full Picture**: verify with Read / Grep / Glob: restate goal, examine failed attempts, fact-check assumptions, form a fresh diagnosis.
3. **Write Report**: fill in zoom-out report template; a complete report releases the breaker.
4. **Decision Gate**: **RESUME** on a clear untried path. **ESCALATE** true user decisions with 2-3 options.
5. **Recovery**: 3 more same-signature failures hard-lock → human clears via `npm run harness:reset`.

## USE FOR:
- "you are stuck in a loop"
- "the same error keeps failing"
- "rethink your assumptions"

## DO NOT USE FOR:
- Routine single-failure debugging — fix it directly
- Greenfield planning without failures (`fable-mode`)

## Pressure Resistance

When pressured to continue retrying:
1. **Acknowledge:** "I understand you want me to keep trying..."
2. **Explain risk:** "...but retrying the same approach 4+ times is wasteful."
3. **Offer alternatives:** "Let me reflect on what's actually wrong first."
4. **Never comply:** Do NOT continue retrying after 3 failures.

Deep dive: references/circuit-breaker.md
