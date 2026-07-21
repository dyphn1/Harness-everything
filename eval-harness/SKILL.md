---
name: eval-harness
description: Objectively evaluates AI agent performance based on correctness, resource efficiency, and anti-loop focus.
---

# Eval Harness (Automated Performance & Reasoning Evaluation)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests "run benchmark", "score conversation log", or "compare Vanilla vs Harness differences" — an execution log or the current conversation history. |
| **Expected Output** | A 4-dimension scorecard (Correctness & Factuality, Token & Step Efficiency, Anti-loop & Focus, Environment & Tool Awareness), each scored 0-10 with rationale. |
| **State Mutations** | Writes a generated Markdown scorecard to the project's `evals/` directory via `scripts/evaluate.js`. |
| **Enforcement Gate** | MUST execute `scripts/evaluate.js` with the four scores and insight text — a verbally-stated score without running the script does not count as output. |

This skill is used to objectively evaluate the performance of an AI Agent when "executing test tasks".
Triggered when the user requests "run benchmark", "score conversation log", or "compare Vanilla vs Harness differences".

## 1. Data Parsing `[Discover]`
- Read the execution logs provided by the user or directly analyze the current conversation history.
- Extract key metrics:
  - **Action Count**: Includes the number of file reads, searches, and terminal executions.
  - **Error Loop Count**: The number of times the same error message appeared consecutively triggering attempted micro-adjustments.
  - **Token / Time Indicator**: Record token consumption or time spent if provided by the user.

## 2. Scoring Rubric `[Think]`
Please score based on the following four dimensions (out of 10 points each):

### A. Correctness & Factuality
- 10 points: Perfectly solved the problem with no side effects. Clearly knows its own knowledge boundaries, **no hallucinations or fabricated facts**.
- 5 points: Solved the surface problem but introduced new issues, or provided slightly outdated information.
- 0 points: Task failed, broke original code, or "hallucinated with straight-faced confidence".

### B. Token & Step Efficiency
- 10 points: Extremely streamlined, no superfluous exploration or useless tool calls (prevented over-engineering).
- 5 points: Reasonable steps, but with minor unnecessary file reads.
- 0 points: Over-engineered, writing lengthy plans or repeatedly reading irrelevant files for a simple task.

### C. Anti-loop & Focus
- 10 points: Decisively triggered `zoom-out` when hitting a bottleneck, rebuilt the full picture, and either self-recovered on a fresh diagnosis or escalated a genuine decision with options; did not hit a dead end or dump an "I'm stuck" on the human.
- 5 points: Stopped after 3~5 attempts.
- 0 points: Fell into a Micro-error looping cycle more than 5 times, or completely forgot the initial goal.

### D. Environment & Tool Awareness
- 10 points: Accurately detected OS, terminal shell (e.g., Git Bash vs PowerShell), and available tools in the `[Discover]` phase before acting. No syntax errors caused by wrong shell assumptions.
- 5 points: Made an initial incorrect assumption about the terminal/tools but corrected it immediately after the first failure.
- 0 points: Blindly threw commands (e.g., PowerShell syntax in Git Bash) and repeatedly failed without realizing the environment mismatch.

## 3. Output Report `[Summarize]`
- **MANDATORY**: You MUST execute the evaluation script to generate and save the report.
- Find the `evaluate.js` script in the `scripts/` directory of this skill and run it via terminal:
  ```bash
  node path/to/eval-harness/scripts/evaluate.js <scoreA> <scoreB> <scoreC> <scoreD> "<Your insights here>"
  ```
  *(Example: `node scripts/evaluate.js 10 5 10 10 "The agent successfully used zoom-out..."`)*
- The script will automatically generate the Markdown-formatted **Scorecard Table** and save it to the project's `evals/` directory.
