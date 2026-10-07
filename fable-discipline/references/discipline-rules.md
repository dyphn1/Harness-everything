# Fable Discipline — Full Detail

This skill acts as the shadow guard for `fable-mode`. As long as `fable-mode` is active, this skill MUST run in the background to prevent large tasks from spiraling out of control.

## 1. Anti-Context Bloat Defense
When executing large architectural tasks, conversation logs expand rapidly, leading to model attention loss (hallucinations or forgetting the original intent).
- **Strategic Compact**: After completing each core milestone, forcefully summarize the current state and decisions, discarding unnecessary past conversation details.
- **Avoid Broad Reads**: Prohibited from using broad Regex searches without precise conditions or reading irrelevant files over 1000 lines.

## 2. Strict Physical Boundaries
- **Environment Isolation**: Before modifying any core architecture, ensure you are clearly aware of the Current Working Directory (CWD).
- **Atomic Commit Boundaries**: Do not modify dozens of files at once before testing. Treat each independently functioning logic block as a suggested commit boundary. Create the commit only when the user or active host/workflow has authorized commits; otherwise leave changes uncommitted and surface the boundary.

## 3. Agent Handoff Protocol
When `fable-mode` spawns and switches between different sub-agents via `multi-agent-workspace`, strict handoff discipline must be observed:
- **State Manifest**: The previous agent MUST leave a clear state record (e.g., what APIs were completed, expected inputs/outputs).
- **Contract Testing**: The very first step for the succeeding agent is to verify if the state manifest left by the previous agent is correct.

## 4. Divergence Signal
- Large tasks easily generate the sunk cost fallacy of "I think it's almost fixed, let me try one more time."
- If Build Errors exhibit a divergent trend (the more you fix, the more it breaks), surface the regression immediately and recommend `zoom-out`; divergence alone is not a hard stop.
- Organize the error dependency graph for the human. Mandatory reflection remains owned by Rule-of-3 after repeated same-signature failures, or by explicit user/host permission boundaries.
