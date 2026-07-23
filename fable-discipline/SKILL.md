---
name: fable-discipline
description: Shadow guard for fable-mode to prevent context bloat and maintain physical boundaries.
author: Miya Daniel | Harness Core Team
version: 0.2.0
---

# Fable Discipline (Macro Task Discipline & Safety Net)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Runs continuously in the background for the entire duration `fable-mode` is active — not a standalone, one-shot trigger. |
| **Expected Output** | Periodic state compaction after each milestone; one Git commit per independently functioning logic block; a state manifest handed off between sub-agents at every handoff point. |
| **State Mutations** | None of its own — it constrains how `fable-mode` and `create-agent-launcher` mutate state (commit cadence, handoff manifests, read-size limits). |
| **Enforcement Gate** | **HALTS execution immediately** (not a retry) if build errors show a divergent trend (more fixes → more breakage), and forces `zoom-out` instead of continued patching. |

This skill acts as the shadow guard for `fable-mode`. As long as `fable-mode` is active, this skill MUST run in the background to prevent large tasks from spiraling out of control.

## 1. Anti-Context Bloat Defense
When executing large architectural tasks, conversation logs expand rapidly, leading to model attention loss (hallucinations or forgetting the original intent).
- **Strategic Compact**: After completing each core milestone, forcefully summarize the current state and decisions, discarding unnecessary past conversation details.
- **Avoid Broad Reads**: Prohibited from using broad Regex searches without precise conditions or reading irrelevant files over 1000 lines.

## 2. Strict Physical Boundaries
- **Environment Isolation**: Before modifying any core architecture, ensure you are clearly aware of the Current Working Directory (CWD).
- **Atomic Commits**: You are NOT allowed to modify dozens of files at once before testing. For every independently functioning logic block completed, advise the human to create a Git Commit as a safe save point.

## 3. Agent Handoff Protocol
When `fable-mode` spawns and switches between different sub-agents via `create-agent-launcher`, strict handoff discipline must be observed:
- **State Manifest**: The previous agent MUST leave a clear state record (e.g., what APIs were completed, expected inputs/outputs).
- **Contract Testing**: The very first step for the succeeding agent is to verify if the state manifest left by the previous agent is correct.

## 4. Ultimate Circuit Breaker: Indefinite Halt
- Large tasks easily generate the sunk cost fallacy of "I think it's almost fixed, let me try one more time."
- If the system's Build Errors exhibit a divergent trend (the more you fix, the more it breaks), **HALT EXECUTION IMMEDIATELY**.
- Call `zoom-out`, organize the error dependency graph for the human, and seek architectural-level refactoring advice.
