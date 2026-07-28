# Phase 1: Platform & Location Preferences

**[State Checkpoint]**
- Verify the `Target Directory` absolute path passed from the initial context.

## [Discovery & Inquiry Phase]
1. Target Selection: First, auto-detect the current environment and target platform (`[Discover]`).
   - Supported target platforms include: **Claude Code, Cursor, Copilot Chat, Codex, Continue.dev, Hermes Agent, Gemini CLI**.
   - Note: Only **Claude Code** supports hard enforcement via native lifecycle hooks (`exit 2`). All other target platforms operate via prompt-based advisory rules (`README.md`).
   - If interactive inquiry tools (like `vscode_askQuestions`) are available, confirm platform and scope location (Project Level vs Global Level) with the user.
   - If running in a non-interactive terminal or without GUI inquiry tools, proceed with the auto-detected platform and default to Project Level location.

## [Validation & Research Phase]
2. Load Guidelines: Read `guidelines/platform-<platform>.md` corresponding to the chosen platform. Treat this local file as the primary source of truth. Avoid unnecessary web searches unless platform APIs are ambiguous.
3. Conflict Assessment: Use the loaded layout rules to check if existing agents are already present in the target location within the `Target Directory`.

## [Action Phase: Conflict Resolution]
4. Preference Gathering: If interactive inquiry tools are available, confirm Resilience Features configuration; otherwise default to standard resilience.
5. Conflict Strategy: If existing agents are found, confirm the Conflict Resolution strategy (Safe Update by default, Backup & Overwrite, or Smart Merge).

## [Record: Handoff]
6. State Packaging: Record the selected `Platform`, `Location`, `Resilience Features`, and `Conflict Strategy`.
7. Handoff: Load and execute `workflows/02-analysis.md`, passing these variables alongside `Target Directory`.