---
name: self-evolve
description: Extracts root causes from resolved difficult problems and persists them as new error boundaries in memory.
author: Miya Daniel | Harness Core Team
version: 0.3.0
---

# Self Evolve (Self Evolution & Memory Extraction)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Task completion after a major struggle, or post-zoom-out recovery. Input: Root cause analysis of previous failure. |
| **Expected Output** | Execution of memory persistence script or generated dynamic skill. |
| **State Mutations** | Updates workspace memory/rules files (`memories/repo/RULES.md` or `.claude/harness-everything/manifest.json`). |
| **Enforcement Gate** | Run regression checks (`node "<this-skill-dir>/scripts/self-regression.js"` or `npx github:dyphn1/Harness-everything test`). Use `node "<this-skill-dir>/scripts/persist-memory.js" "<rule>"` to save concise rules. |

This skill enables long-term learning by extracting root causes from resolved challenges and recording defensive rules for future sessions.

**Environment Requirements**: `persist-memory.js` and `register-dynamic-skill.js` require Node.js on `PATH` and should be executed within a Git repository context to correctly locate workspace boundaries. Run either script with `--help` for its full argument reference.

## 1. Triggers
- **Post-Circuit Breaker**: Following successful recovery after a `zoom-out` reflection.
- **Major Breakthrough**: Upon completing complex tasks that revealed non-obvious framework limits or architectural edge cases.
- **Explicit Request**: When the user asks to "remember this lesson" or "save this to memory".

## 2. Execution Process (The Evolution Loop)

### Step 1: Deep Reflection & Root Cause Extraction
Analyze the resolved issue and extract a universal, high-level root cause rather than file-specific line details.

### Step 2: Define Error Boundaries
Format the insight into a concise defensive rule to help future agent sessions avoid similar pitfalls.

### Step 3: Persistence & Dynamic Skill Promotion
- **Run Regression Check**: Validate system state by running:
  ```bash
  node "<this-skill-dir>/scripts/self-regression.js"
  # Or universally from any project root:
  npx github:dyphn1/Harness-everything test
  ```
- **Persist Rule**: Save concise guidelines using the persistence script:
  ```bash
  node "<this-skill-dir>/scripts/persist-memory.js" "<Your extracted root cause and defensive rule>"
  ```
- **Dynamic Skill Promotion**:
  - For simple tips or codebase quirks: keep as a lightweight rule in `memories/repo/RULES.md`.
  - For complex, multi-step procedures or architectural patterns: promote to a dynamic skill following `skill-creator/SKILL.md` §4, and register it via `node "<this-skill-dir>/scripts/register-dynamic-skill.js" <name>`.

## 3. Purpose
Through `self-evolve`, we transform "invalid trial-and-error", which might otherwise waste Tokens, into a valuable "moat" for the system. Even if the underlying model doesn't become inherently smarter, equipped with these memories, the system will automatically avoid known traps and break through its original reasoning ceiling.
