# Phase 4: Launcher Bootstrapping

**[State Checkpoint]**
- MUST verify the inheritance of `Target Directory`, `Context Profile`, `Selected Agents`, and paths of the newly created files from Phase 3.
- MUST ensure terminal is located at the `Target Directory`.

## [Action Phase: Entry Point Generation]
1. Entry Point Gen: MUST read `templates/agent-launcher.md`.
2. Handoff Integration: MUST substitute placeholders using the `Context Profile`. MUST dynamically inject the paths and roles of the `Selected Agents` into the Launcher, ensuring it accurately serves as the central router for the ecosystem.
3. Disk Write: MUST save to the skill entry point path defined in the platform guidelines securely.

## [Summarize: Verification]
4. Check: MUST verify the Launcher was written successfully.

## [Record: Exit]
5. Completion: MUST report successful scaffold generation to the user. MUST provide a summary table of ALL generated files (including Subagents and the Launcher) and their status.
6. UX Handoff: MUST prompt the user to launch their first agent workflow with a suggested message (e.g., "Agentic workflow scaffold is ready. To launch your first agent workflow, use the launcher...").
7. Exit: MUST terminate execution.

[Exit: Await User Instruction]