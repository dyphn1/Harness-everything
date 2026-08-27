---
name: zoom-out
description: "Reflect-first circuit breaker - after 3 failures, stop edits, rebuild the full picture with read-only tools, write a fact-check report, then resume or escalate. USE FOR: \"you are stuck in a loop\", \"the same error keeps failing\", \"rethink your assumptions\". DO NOT USE FOR: \"routine single-failure debugging\", \"greenfield planning without failures\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Zoom Out (Circuit Breaker)

## ⚠️ CRITICAL RULE: STOP RETRY LOOPS

**After 3 failures:**
- **STOP all edit attempts**
- **DO NOT ask the user** — reflect first
- **DO NOT continue retrying**

## Circuit Breaker Flow

1. **Cease Fire**: pause edits; no guessing before checking facts.
2. **Rebuild Full Picture**: verify with Read / Grep / Glob; form fresh diagnosis.
3. **Write Report**: fill in report template; complete report releases breaker.
4. **Decision Gate**: **RESUME** on untried path or **ESCALATE** with options.
5. **Recovery**: 3 more same-signature failures → human clears via reset.

## USE FOR:
- "you are stuck in a loop"
- "the same error keeps failing"
- "rethink your assumptions"

## DO NOT USE FOR:
- Routine single-failure debugging
- Greenfield planning (`fable-mode`)

## Pressure Resistance

When pressured to retry:
1. **Acknowledge:** "I understand you want me to keep trying..."
2. **Explain:** "...but retrying same approach 4+ times is wasteful."
3. **Offer:** "Let me reflect first."
4. **Never comply** after 3 failures.

Deep dive: references/circuit-breaker.md
