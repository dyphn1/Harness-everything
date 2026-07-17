---
name: self-evolve
description: Extracts root causes from resolved difficult problems and persists them as new error boundaries in memory.
---

# Self Evolve (Self Evolution & Memory Extraction)

This skill is responsible for the long-term learning and error prevention of the system.
It ensures that the entire Harness ecosystem becomes smarter and avoids repeating mistakes after solving difficult problems every time.

## 1. Triggers
- **Post-Circuit Breaker**: When `zoom-out` was triggered, and the difficult problem was ultimately solved with the human's hints.
- **Major Breakthrough**: Completed an extremely complex Tier 3 task, and discovered some previously unknown framework limitations or architectural pitfalls during the process.
- **Human Instruction**: The user explicitly requests "remember this lesson" or "add this to memory".

## 2. Execution Process (The Evolution Loop)

### Step 1: Root Cause Extraction
- Analyze the problem just solved, discarding specific variable names or specific line numbers of code.
- Extract the **high-level, universally applicable root cause**.
- *Incorrect Extraction*: "Do not use `forEach` to call the database on line 45 of `auth.js`."
- *Correct Extraction*: "When handling ORM relational writes in this project, you MUST use Transactions and batch writes. Sending Queries individually in a loop is PROHIBITED, otherwise it will cause connection pool exhaustion."

### Step 2: Define Error Boundaries
- Transform the extracted root cause into a defensive rule for `install-cognitive-os` to reference in the future.
- Explicitly define which domain this new rule applies to (e.g., Database, React Hooks, specific API integration).
- **Anti-Focus Loss**: This rule must be able to directly guide future Agents to notice this landmine during the `[Discover]` phase, instead of finding out only after writing it wrong.

### Step 3: Memory Persistence
- Use corresponding file writing tools to write these abstracted lessons into the project's long-term memory area (e.g., corresponding `.md` files under `/memories/repo/`, or updating the project's `RULES.md`).
- **Note**: Only record "Key Insights", keeping the memory document short and punchy. Avoid stuffing it with lengthy conversation logs or useless narratives.

## 3. Purpose
Through `self-evolve`, we transform "invalid trial-and-error", which might otherwise waste Tokens, into a valuable "moat" for the system. Even if the underlying model doesn't become inherently smarter, equipped with these memories, the system will automatically avoid known traps and break through its original reasoning ceiling.
