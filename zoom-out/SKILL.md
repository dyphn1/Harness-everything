---
name: zoom-out
description: The ultimate circuit breaker triggered upon hitting logic blind spots, micro-error looping, or the reasoning ceiling.
---

# Zoom Out (Global Perspective & Circuit Breaker)

This skill is the **Ultimate Circuit Breaker** in the Harness system.
It MUST be forcefully triggered when the Agent falls into logic blind spots, invalid retries, or hits the Reasoning Ceiling.

## 1. Triggers
- **Rule of 3 (Micro-error looping)**: This is the most common fatal flaw of AI. If attempting to fix the same error, same test failure, or same logic fails 3 times consecutively, or if constantly making minor invalid changes in the same place (e.g., repeatedly changing variable names or adding console.log but it's still broken).
- **Divergence Phenomenon**: Fixing one Bug leads to 2 new Bugs, and fixing those triggers even more errors.
- **Attention Loss**: You realize you have forgotten the initial task goal, or the files being modified deviate too far from the original goal.
- **Human Intervention**: The user explicitly instructs "zoom out", "step back and look", or "stop and think".

## 2. Halt and Assess
When this skill is triggered, you MUST immediately take the following actions, with NO exceptions:

### Step 1: Cease Fire
- **ABSOLUTELY PROHIBITED** from proposing any new code modification suggestions.
- **ABSOLUTELY PROHIBITED** from saying "I understand, I will fix it using the following method...".

### Step 2: Elevate Perspective
- Step out of the entangled lines of code or specific syntax.
- Re-examine the problem from the architectural level, system level, or even business logic level.
- Ask yourself: Is this really what this module should be doing? Did the upstream pass the wrong data? Is this a limitation of the underlying framework itself?

### Step 3: Report to Human and Seek Guidance
Organize the past 3 failed attempts, admit hitting a limit, and hand over the decision to the human:
> "I have tried methods X, Y, and Z, but they all failed. This seems to have hit the limit of the current implementation path.
> The problem here might not be the syntax, but rather [Architectural Design / Package Limitation / Requirement Contradiction].
> Should we switch to a different algorithm? Or do you have other domain intuition to provide guidance?"

## 3. Recovery Mechanism
Only after the human provides a clear new direction, additional domain knowledge, or explicit instructions to restart the attempt, can you exit the `zoom-out` state and reload the corresponding execution mode (like `tdd` or `fable-mode`).
