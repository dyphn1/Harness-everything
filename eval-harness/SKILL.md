---
name: eval-harness
description: Evaluate AI agent performance across correctness, token efficiency, anti-loop focus, and environment awareness; save a 4-dimension scorecard. Use when asked to run a benchmark or score an execution log or conversation history.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Eval Harness (Automated Performance & Reasoning Evaluation)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger** | "run benchmark" / "score conversation log"; input is an execution log or history. |
| **Output** | 4-dimension scorecard (0-10) with rationale, saved to `evals/`. |
| **Mutations** | Writes scorecard to `evals/` or `.github/harness-everything/evals/`. |
| **Gate** | Run evaluation script; write scorecard directly if script fails. |

## Workflow

1. **Parse** the log or history `[Discover]`: action count, error loop count, tokens/time if provided.
2. **Score** four dimensions (0-10 each) `[Think]`: **A. Correctness & Factuality**, **B. Token & Step Efficiency**, **C. Anti-loop & Focus**, **D. Environment & Tool Awareness** — full anchors in references.
3. **Report** `[Summarize]` — MANDATORY script execution:
   ```bash
   node "<this-skill-dir>/scripts/evaluate.js" <scoreA> <scoreB> <scoreC> <scoreD> "<Your insights here>"
   ```
   Example: `node scripts/evaluate.js 10 5 10 10 "The agent successfully used zoom-out..."` (`--help` shows scoring reference).
4. **Fallback**: if the script fails or is missing, write `evals/scorecard.md`, else `.github/harness-everything/evals/scorecard.md`.

## USE FOR:
- "run a benchmark on this log"
- "score this agent execution"
- "compare Vanilla vs Harness"
- "generate an evaluation scorecard"

## DO NOT USE FOR:
- Writing or fixing code being evaluated
- General review without scoring dimensions
- Tasks with no execution log

Deep dive: references/scoring-rubric.md
