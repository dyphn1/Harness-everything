---
name: zoom-out
description: Reflect-first circuit breaker - rebuild the full picture and fact-check assumptions when stuck; escalate to the human only for genuine decisions.
author: Miya Daniel | Harness Core Team
version: 0.3.0
---

# Zoom Out (Global Perspective & Circuit Breaker)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Terminal script failures 3 times in a row, or getting stuck in a loop. Input: Error logs. |
| **Expected Output** | Reflection report written to disk. Mutating terminal commands pause until reflection is complete. |
| **State Mutations** | Writes `zoom-out-report.md` at the path provided by the Rule of 3 breaker message (session-scoped). |
| **Enforcement Gate** | The `rule-of-3.js` script (via Hook or CLI) allows writing `zoom-out-report.md` to unlock mutating operations. |

This skill serves as a circuit breaker to help agents step back, re-verify assumptions, and rebuild global context when stuck.

Its purpose is self-recovery through reflection. When faced with repeated failures, stepping back to re-verify assumptions against codebase facts prevents unhelpful trial-and-error loops. Escalation to the user happens when a genuine architectural or requirements decision is needed.

> **Platform note**: See [README § Supported AI IDEs & Tools](../README.md#supported-ai-ides--tools) for which platforms enforce this physically (`exit 2` hooks) vs. advisory only. On advisory-only platforms, follow this reflection protocol self-directed when hitting 3 consecutive failures.

## 1. Triggers
- **Rule of 3 (Repeated Failures)**: Attempting to fix the same error or test failure 3 times without progress.
- **Divergence**: Fixing one bug repeatedly introduces new secondary errors.
- **Goal Drift**: Execution strays far from the initial task objective.
- **User Instruction**: The user requests a step back ("zoom out", "step back", "stop and think").

## 2. Phase 1 — Cease Fire
- Pause code editing attempts immediately.
- Refrain from guessing quick fixes without checking underlying facts first.

## 3. Phase 2 — Rebuild Full Picture (Reflect & Fact-Check)
Use read-only tools (Read / Grep / Glob) to gather fresh evidence:
1. **Restate Goal**: Review original objectives from task/todo context.
2. **Examine Failed Attempts**: Identify the underlying belief behind each failed fix.
3. **Fact-Check Assumptions**: Verify files, configuration, logs, and docs directly.
4. **Elevate Perspective**: Check for layer mismatches, API contract misunderstandings, or conflicting requirements.
5. **Form Fresh Diagnosis**: Synthesize a comprehensive explanation that accounts for all observed evidence.

## 4. Phase 3 — Write Reflection Report
Copy `zoom-out/templates/zoom-out-report.template.md` to the `zoom-out-report.md` path given in the Rule of 3 message and fill it in section by section.

A complete report automatically releases the circuit breaker on hook-enabled systems.

## 5. Phase 4 — Decision Gate: Resume or Escalate

- **RESUME**: Selected when the fresh diagnosis identifies a clear, untried path within existing authority.
- **ESCALATE**: Reserved for true decision points belonging to the user (conflicting requirements, destructive migration, missing credentials/access, or repeated breaker trips).
Hand the human a **decision**, not a plea:

> "Goal: [...]. I falsified paths X, Y, Z — verified facts: [...].
> The real blocker is a [requirement conflict / architecture trade-off / destructive step / access gap], which is your call, not mine.
> Option A: [...] (trade-off: ...). Option B: [...] (trade-off: ...).
> I recommend A because [...]. Which direction do you choose?"

Banned: "I have tried everything and failed, please help." That reports incapability, not a decision.

## 7. Recovery
- **Self-recovery path**: a valid report ending in `RESUME` releases the breaker — reload the appropriate execution mode (`tdd`, `fable-mode`) and execute the new diagnosis. If the SAME failure signature accumulates 3 more failures, the breaker hard-locks and the decision goes to the human.
- **Human path**: after the human answers an `ESCALATE`, or clears a hard lock (`npm run harness:reset` in their own terminal, or a new session / `/clear`), continue under their direction.
- Either way, once the problem is ultimately cracked, feed the insight to `self-evolve`.
