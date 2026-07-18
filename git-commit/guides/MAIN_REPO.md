# Main Repo Processing Workflow

**[State Checkpoint]**
- MUST verify terminal is located at the Main Repo root.
- MUST acknowledge and retrieve any completed Sub Repo updates passed down from the previous phase.

## [Elimination Phase]
1. Diff Analysis: MUST analyze `git diff --cached` securely to identify staged changes (including Sub Repo pointer updates).
2. Validation: IF no staged changes exist, MUST declare success and terminate workflow without further action.

## [Summarize Phase]
3. Context Gathering: IF Sub Repo pointer updates exist, MUST extract their commit logs (e.g., via `git log --oneline <old>..<new>`) to serve as context for the Main Repo commit.

## [Action Phase]
4. Commit Generation: MUST explicitly pass the verified diff and extracted Sub Repo logs as context, then execute `COMMIT_GENERATION.md`.