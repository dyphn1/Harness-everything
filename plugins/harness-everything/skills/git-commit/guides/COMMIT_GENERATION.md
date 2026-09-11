# Commit Generation Workflow

**[State Checkpoint]**
- MUST verify the target repository path passed from the previous step.
- MUST ensure terminal is located in the target repository BEFORE generating commits.
- MUST explicitly recall diff content and any provided Sub Repo logs.

## [Preparation Phase]
1. Language Selection: MUST execute `LANGUAGE_DETECTION.md`.
2. Format Rules: MUST read and strictly follow `ANGULAR_STYLE.md`.

## [Action Phase]
3. Message Construction: MUST generate a strict Angular format message (Type, Scope, Subject, Body, Footer) integrating diff analysis.
   - MUST perform a detailed analysis on `git diff --cached` to extract the exact files modified, functions/classes added or adjusted, and logical configuration changes.
   - MUST compile these extracted points into a structured, bulleted list in the commit message body (e.g., listing changes file-by-file or feature-by-feature) so that the commit message serves as an accurate, self-contained changelog of the staged changes.
4. Context Integration: IF Sub Repo logs were passed, MUST seamlessly integrate ALL Sub Repo log summaries into the commit body.
5. State Isolation: MUST ignore unstaged changes AND MUST NOT run `git add` to prevent contamination.
6. Execution: MUST execute the commit securely (e.g., `git commit -F - <<EOF` or writing to a temporary file) to ensure special characters do not break the terminal command.

## [Validation & Summarize Phase]
7. Error Handling: MUST verify if the commit command succeeded. IF it fails (e.g., pre-commit hooks, GPG), MUST NOT blindly halt. MUST diagnose the error, preserve the generated message in a temporary file, and pause to ask the user for remediation.

## [Record: Handoff]
8. Handoff: MUST record the successful commit log summary and return control with updated state to the calling workflow.