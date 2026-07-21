---
name: zoom-out
description: Reflect-first circuit breaker - rebuild the full picture and fact-check assumptions when stuck; escalate to the human only for genuine decisions.
---

# Zoom Out (Global Perspective & Circuit Breaker)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Terminal script failures 3 times in a row, or getting stuck in an infinite loop. Input: Error logs. |
| **Expected Output** | Reflection report written to disk. Terminal commands MUST STOP until the report is completed. |
| **State Mutations** | MUST write `.harness/zoom-out-report.md`. |
| **Enforcement Gate** | The `rule-of-3.js` script (if run via Hook or CLI) will block all other `Write` or `Edit` actions until `.harness/zoom-out-report.md` exists and is formatted correctly. |

This skill is the **Ultimate Circuit Breaker** in the Harness system.
It MUST be forcefully triggered when the Agent falls into logic blind spots, invalid retries, or hits the Reasoning Ceiling.

Its purpose is **NOT** to hand the problem to the human. The most common fatal flaw when stuck is failing to step back and rebuild a complete overview of the problem — three failures in a row almost always share one unverified assumption. This skill forces that step. The Human Partner is interrupted only when there is a genuine **decision** that belongs to them, never as a substitute for reflection you have not done yet.

> **Platform note**: only Claude Code enforces this breaker physically (hooks lock mutating tools; a valid report releases them). On advisory-only platforms (Cursor, Copilot, Gemini CLI, Codex CLI...) nothing will stop you — the protocol is identical and **self-enforced**: stop at 3 failures, run Phases 1-4 exactly as written, and still write the report file as the reflection artifact.

## 1. Triggers
- **Rule of 3 (Micro-error looping)**: This is the most common fatal flaw of AI. If attempting to fix the same error, same test failure, or same logic fails 3 times consecutively, or if constantly making minor invalid changes in the same place (e.g., repeatedly changing variable names or adding console.log but it's still broken).
- **Divergence Phenomenon**: Fixing one Bug leads to 2 new Bugs, and fixing those triggers even more errors.
- **Attention Loss**: You realize you have forgotten the initial task goal, or the files being modified deviate too far from the original goal.
- **Human Intervention**: The user explicitly instructs "zoom out", "step back and look", or "stop and think".

## 2. Phase 1 — Cease Fire
- **ABSOLUTELY PROHIBITED** from proposing any new code modification suggestions.
- **ABSOLUTELY PROHIBITED** from saying "I understand, I will fix it using the following method..." — that sentence is the tunnel talking.
- **Do NOT message the Human Partner yet.** "I failed 3 times" is not yet a report worth their time; reflection comes first.

## 3. Phase 2 — Rebuild the Full Picture (Reflect & Fact-Check)
Use **READ-ONLY tools** (Read / Grep / Glob) — they remain available while the breaker is locked. No guessing in this phase; only evidence.

1. **Restate the original goal** — from the task / todo list, not from your memory of the current rabbit hole. Ask: does the thing I have been fighting even matter to this goal?
2. **List each failed attempt and extract the assumption behind it.** Every fix attempt encoded a belief about the system; name each belief explicitly.
3. **Fact-check every assumption against reality.** Open the actual file, the actual log, the actual config, the actual upstream data, the actual docs. Replace every "it should be" with "I looked, and it is".
4. **Raise the altitude.** Is this even the right layer? Is the module doing what the architecture intends? Did upstream pass wrong data? Is this a framework limitation? Do two requirements contradict each other?
5. **Form a fresh diagnosis** that explains **ALL** observed evidence — including why all previous attempts failed — not just the latest error message.

## 4. Phase 3 — Write the Reflection Report
Write your findings to `.harness/zoom-out-report.md` — the ONLY write permitted while the breaker is locked. (If the file already exists from an earlier cycle, Read it first so you do not re-propose an already-falsified diagnosis.) Required sections:

```markdown
## Goal
<the original task goal, restated from source>
## Failed Attempts
<attempt → the assumption it relied on → why it was wrong>
## Verified Facts
<only things you actually re-checked in Phase 2, each with where you looked>
## Diagnosis
<the fresh root-cause explanation covering all evidence>
## Decision
RESUME: <the new approach>   — or —   ESCALATE: <the decision the human must make>
```

A valid report automatically releases the circuit breaker. This is not paperwork — the hook checks it precisely because writing it honestly IS the reflection.

## 5. Phase 4 — Decision Gate: Resume or Escalate

**RESUME (the default and expected outcome)** when the fresh diagnosis yields a genuinely NEW path — a different layer, different root cause, or different approach, not a variation of the attempts that already failed — and it is within your existing authority and task scope. Self-recovery is what zoom-out is for.

**ESCALATE only when the blocker is a decision that belongs to a human**, such as:
- Requirements contradict each other, or the goal itself is ambiguous.
- The fix requires an architecture / scope trade-off the human has not sanctioned (rewriting a module, changing a public API, dropping a requirement).
- The path forward is destructive or irreversible (data migration, force push, deleting user data).
- You lack access only the human can grant (credentials, environment, third-party service).
- This is the SECOND breaker trip on the same failure signature — reflection already had its shot; the hook hard-locks and the human decides.

**"I am not capable of fixing this" is NOT an escalation reason** — that conclusion is usually the tunnel still talking; zoom out further instead. **"This requires a choice only you can make"** is.

## 6. Escalation Format (only when genuinely needed)
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
