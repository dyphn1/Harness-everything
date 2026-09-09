---
name: zoom-out
description: "Reflect-first circuit breaker - after 3 failures, stop edits, rebuild the full picture with read-only tools, write a fact-check report, then resume or escalate. USE FOR: \"you are stuck in a loop\", \"the same error keeps failing\", \"rethink your assumptions\". DO NOT USE FOR: \"routine single-failure debugging\", \"greenfield planning without failures\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Zoom Out (Circuit Breaker)

Stop repeated failures, rebuild the facts, and choose a safe next step.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Three same-signature failures or an explicit loop/rethink request. |
| **Expected Output** | Fact-checked report ending in `RESUME` or `ESCALATE`. |
| **State Mutations** | Writes the session `zoom-out-report.md`; reset may clear breaker state. |
| **Enforcement Gate** | `<skills-repo-root>/hooks/scripts/rule-of-3.js` plus a valid report; reset only after the second cycle. |

## Circuit Breaker Flow

1. After three same-signature failures, stop edits and do not ask the user yet.
2. Use read-only tools to restate the goal and check files, configuration, and logs.
3. Fill `<this-skill-dir>/templates/zoom-out-report.template.md` and end with `RESUME` or `ESCALATE`.
4. Resume only on an untried path; escalate genuine user decisions with options.
5. Clear a repeated breaker cycle with `npm run harness:reset`; record the insight with `self-evolve`.

## USE FOR:
- "you are stuck in a loop"
- "the same error keeps failing"
- "rethink your assumptions"

## DO NOT USE FOR:
- Routine single-failure debugging — fix it directly
- Greenfield planning without failures (`fable-mode`)

Never retry the same approach after the third failure, even under pressure.

Deep dive: `<this-skill-dir>/references/circuit-breaker.md`
