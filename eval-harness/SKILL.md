---
name: eval-harness
description: Evaluate AI agent performance across correctness, token efficiency, anti-loop focus, and environment awareness; save a 4-dimension scorecard. Use when asked to run a benchmark or score an execution log or conversation history.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Eval Harness

Evaluate an agent log with a four-dimension scorecard.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | A benchmark request and an execution log or conversation history. |
| **Expected Output** | A 0–10 scorecard for correctness, efficiency, anti-loop focus, and environment awareness. |
| **State Mutations** | Writes the scorecard under `evals/` or `.github/harness-everything/evals/`. |
| **Enforcement Gate** | Run `scripts/evaluate.js`; use the documented fallback only if it fails or is missing. |

## Workflow

1. Parse actions, errors, tokens, and timing from the log.
2. Score all four dimensions using `references/scoring-rubric.md`.
3. Run `node scripts/evaluate.js <A> <B> <C> <D> "insights"`.
4. If the script fails, write `<workspace>/evals/scorecard.md` (or the `.github` fallback).

## USE FOR:

- Running a benchmark or scoring an agent execution.
- Comparing Vanilla and Harness execution.
- Generating a four-dimension scorecard.

## DO NOT USE FOR:

- Writing or fixing the evaluated code.
- General review without scoring dimensions.
- Tasks without an execution log.

Deep dive: `references/scoring-rubric.md`
