---
name: zoom-out
description: "Reflect-first circuit breaker - after 3 failures, stop edits, rebuild the full picture with read-only tools, write a fact-check report, then resume or escalate. USE FOR: \"you are stuck in a loop\", \"the same error keeps failing\", \"rethink your assumptions\". DO NOT USE FOR: \"routine single-failure debugging\", \"greenfield planning without failures\"."
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# Zoom Out (Global Perspective & Circuit Breaker)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger** | 3 consecutive failures, goal drift, or "step back" request. |
| **Output** | Reflection report on disk/inline, then recovery or escalation. |
| **Mutations** | Writes `zoom-out-report.md` (session path or `.github/harness-everything/`). |
| **Gate** | Pause edits at 3 failures; report before resuming. |

## Circuit Breaker Flow

1. **Cease Fire**: pause edits; no guessing fixes before checking facts.
2. **Rebuild Full Picture**: verify with Read / Grep / Glob: restate goal, examine failed attempts' beliefs, fact-check assumptions vs files/config/logs, check layer/API mismatches, form a fresh diagnosis.
3. **Write Report**: fill in `zoom-out/templates/zoom-out-report.template.md` at the `zoom-out-report.md` path; a complete report releases the breaker.
4. **Decision Gate**: **RESUME** on a clear untried path — reload `tdd`/`fable-mode`. **ESCALATE** true user decisions (conflicting requirements, destructive migration, missing access) with 2-3 options.
5. **Recovery**: 3 more same-signature failures hard-lock → human clears via `npm run harness:reset`; feed insight to `self-evolve`.

## USE FOR:
- "you are stuck in a loop"
- "the same error keeps failing"
- "rethink your assumptions"

## DO NOT USE FOR:
- Routine single-failure debugging — fix it directly
- Greenfield planning without failures (`fable-mode`)

Deep dive: references/circuit-breaker.md
