# Phase 1: Platform & Location Preferences

**[State Checkpoint]**
- MUST verify the `Target Directory` absolute path passed from the previous step.

## [Discovery & Inquiry Phase]
1. Target Selection: First, auto-detect the current environment and target platform (`[Discover]`).
   - IF interactive inquiry tools (like `vscode_askQuestions`) are available, confirm platform (Copilot, Claude, Gemini, Codex) and scope location (Project Level vs Global Level) with the user.
   - IF running in a non-interactive terminal or without GUI inquiry tools, proceed with the auto-detected platform and default to Project Level location.

## [Validation & Research Phase]
2. Load Guidelines: MUST read `guidelines/platform-<platform>.md` corresponding to the chosen platform. MUST treat this local file as the single source of truth. DO NOT perform web research for platform APIs unless explicitly instructed or if the file contains severe logic gaps.
3. Conflict Assessment: MUST use the loaded layout rules to check if existing agents are already present in the target location within the `Target Directory`.

## [Action Phase: Conflict Resolution]
4. Preference Gathering: IF interactive inquiry tools are available, ask for Resilience Features configuration; otherwise default to standard resilience.
5. Conflict Strategy: IF existing agents are found in the previous step, confirm Conflict Resolution strategy (Safe Update by default, Backup & Overwrite, Smart Merge).

## [Record: Handoff]
6. State Packaging: MUST explicitly record the selected `Platform`, `Location`, `Resilience Features`, and `Conflict Strategy`.
7. Handoff: MUST execute `workflows/02-analysis.md` and explicitly pass these variables alongside the `Target Directory`.