---
name: self-evolve
description: Extracts root causes from resolved difficult problems and persists them as new error boundaries in memory.
author: Miya Daniel | Harness Core Team
version: 0.2.0
---

# Self Evolve (Self Evolution & Memory Extraction)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Task completion after a major struggle, or post-zoom-out recovery. Input: The root cause of the previous failure. |
| **Expected Output** | Terminal execution of the persistence script. |
| **State Mutations** | Updates workspace memory/rules files (e.g., `RULES.md` or `.claude/harness-state/memories.json`). |
| **Enforcement Gate** | You MUST run `node <this-skill-dir>/scripts/self-regression.js`. You MUST run `node <this-skill-dir>/scripts/persist-memory.js "<rule>"`. |

This skill is responsible for the long-term learning and error prevention of the system.
It ensures that the entire Harness ecosystem becomes smarter and avoids repeating mistakes after solving difficult problems every time.

## 1. Triggers
- **Post-Circuit Breaker**: When `zoom-out` was triggered, and the difficult problem was ultimately solved — via the reflection report's fresh diagnosis or with the human's hints.
- **Major Breakthrough**: Completed an extremely complex Tier 3 task, and discovered some previously unknown framework limitations or architectural pitfalls during the process.
- **Human Instruction**: The user explicitly requests "remember this lesson" or "add this to memory".

## 2. Execution Process (The Evolution Loop)

### Step 1: Deep Reflection & Root Cause Extraction
- **Reflection is Core**: Reflection is the true focus of the memory system. Mere recording cannot improve accuracy; you must continuously reflect to self-evolve.
- Analyze the problem just solved, discarding specific variable names or specific line numbers of code.
- Extract the **high-level, universally applicable root cause**.
- *Incorrect Extraction*: "Do not use `forEach` to call the database on line 45 of `auth.js`."
- *Correct Extraction*: "When handling ORM relational writes in this project, you MUST use Transactions and batch writes. Sending Queries individually in a loop is PROHIBITED, otherwise it will cause connection pool exhaustion."

### Step 2: Define Error Boundaries
- Transform the extracted root cause into a defensive rule for `install-cognitive-os` to reference in the future.
- Explicitly define which domain this new rule applies to (e.g., Database, React Hooks, specific API integration).
- **Anti-Focus Loss**: This rule must be able to directly guide future Agents to notice this landmine during the `[Discover]` phase, instead of finding out only after writing it wrong.

### Step 3: Memory Persistence & Dynamic Skill Generation
- **MANDATORY**: Before persisting or committing any dynamically generated skills or memories, you MUST run the self-regression suite to ensure no behavioral regressions or syntax errors were introduced. Both scripts below live in the `scripts/` directory **inside this skill's own directory** — resolve paths from wherever this SKILL.md was loaded (do not guess a hard-coded location):
  ```bash
  node "<this-skill-dir>/scripts/self-regression.js"
  ```
- **MANDATORY**: You MUST execute the persistence script instead of manually editing files or calling write tools:
  ```bash
  node "<this-skill-dir>/scripts/persist-memory.js" "<Your extracted root cause and defensive rule here>"
  ```
- **Dynamic Skill Generation (Session Packaging)**: Through self-review, package the successful session summary (hard boundary) into a new, dynamic skill. **You MUST load `skill-creator/SKILL.md` and follow its §4 Dynamic Skill Generation Contract** before writing the file — it defines the required location (`.claude/harness-everything/skills/generated/<name>/SKILL.md`, not the repo root), the required lifecycle frontmatter (`metadata.type: dynamic`, `status: draft`), and the Quality Checklist gate this file must pass since it skips human PR review by design. Do not hand-write a `SKILL.md` inline here; that checklist is the only review a dynamically generated skill gets. These dynamically generated skills have a lifecycle — draft → active → deprecated, or promoted to a static skill once proven general — distinct from the system's foundational static skills.
- **Note**: Only record "Key Insights", keeping the memory document short and punchy. Avoid stuffing it with lengthy conversation logs or useless narratives.

## 3. Purpose
Through `self-evolve`, we transform "invalid trial-and-error", which might otherwise waste Tokens, into a valuable "moat" for the system. Even if the underlying model doesn't become inherently smarter, equipped with these memories, the system will automatically avoid known traps and break through its original reasoning ceiling.
