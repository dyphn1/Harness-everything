# SKILL Document Writing Guidelines

> Target: Markdown files read and executed as Prompts during SKILL execution (excludes Template files).

## [Language & Syntax]
1. All content MUST be in English (All English).
2. MUST exclusively use task-based syntax (Imperative verbs, numbered lists).
3. Vague tone is strictly forbidden. MUST use uppercase `MUST` or `MUST NOT` to define behaviors. Words like `should` or `may` are forbidden.
4. The length of each rule MUST NOT exceed 150 characters.

## [Flow & Linearity]
5. The SKILL entry point (SKILL.md) MUST be executed only once.
6. The flow from SKILL.md to the end MUST be a flattened straight line. Infinite loops or branching trees are forbidden.
7. All files MUST form a logical closed loop. If conditionals exist, each state MUST point to a deterministic next step or exit.
8. Each MD file MUST NOT exceed 60 lines. If split, the current file MUST end with a unique pointer to maintain linearity.

## [Cognitive Loop & Execution]
9. Steps MUST be written sequentially. Every SKILL file MUST explicitly include this declaration:
   ```markdown
   ## Core Principles
   - MUST operate using the cognitive loop: Think > Try > Summarize > Record.
   - [Think] MUST build a holistic mental router map before starting. Use elimination to discard impossible approaches. Perform forward prediction to simplify actions.
   - [Try] MUST verify current environment boundaries BEFORE taking action. Execute steps sequentially and NEVER combine commands, ensuring errors remain isolated and traceable.
   - [Summarize] MUST verify actual outcomes against initial intent; hallucinating success is forbidden. If an attempt fails, diagnose, zoom out, and backtrack.
   - [Record] MUST explicitly state variables and context to carry over.
   - [Reflect & Re-Think] MUST actively feed the `[Record]` (especially past failures and state changes) back into the next `[Think]` cycle. Use historical context to refine forward predictions and strictly avoid repeating previously diagnosed errors.
   
   ## Cognitive Foundation (Why we do this)
   - Recording is not the end; it is the absolute prerequisite for the next Think cycle.
   - Trying validates the predicted steps.
   - Summarizing confirms if the outcome aligns with the initial intent.
   - The loop is continuous. Converging the chain of thought is the absolute priority; divergent thinking causes attention loss. This cycle (Think > Try > Summarize > Record > Re-Think) drives self-adaptation and evolution.
   - Treat these rules as strict guardrails. Autonomous optimization within these boundaries is expected.
   ```