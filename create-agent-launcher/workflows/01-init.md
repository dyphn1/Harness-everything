# Phase 1: Platform & Location Preferences

**[State Checkpoint]**
- MUST verify the `Target Directory` absolute path passed from the previous step.

## [Discovery & Inquiry Phase]
1. Target Selection: MUST use `vscode_askQuestions` to ask platform and location in one prompt.
   - Target Platform options MUST include Copilot, Claude, Gemini, and Codex.
   - Target Location options MUST include Project Level and Global Level.
   - MUST NOT auto-detect the platform.

## [Validation & Research Phase]
2. Load Guidelines: MUST read `guidelines/platform-<platform>.md` corresponding to the chosen platform. MUST treat this local file as the single source of truth. DO NOT perform web research for platform APIs unless explicitly instructed or if the file contains severe logic gaps.
3. Conflict Assessment: MUST use the loaded layout rules to check if existing agents are already present in the target location within the `Target Directory`.

## [Action Phase: Conflict Resolution]
4. Preference Gathering: MUST use `vscode_askQuestions` to ask for Resilience Features configuration.
5. Conflict Strategy: IF existing agents are found in the previous step, MUST ask for Conflict Resolution strategy (Safe Update, Backup & Overwrite, Smart Merge).

## [Record: Handoff]
6. State Packaging: MUST explicitly record the selected `Platform`, `Location`, `Resilience Features`, and `Conflict Strategy`.
7. Handoff: MUST execute `workflows/02-analysis.md` and explicitly pass these variables alongside the `Target Directory`.