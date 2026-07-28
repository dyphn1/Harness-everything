# Phase 3: Scaffold Generation

**[State Checkpoint]**
- Verify inheritance of `Target Directory`, `Context Profile`, `Selected Agents`, and Phase 1 variables (`Platform`, `Conflict Strategy`, etc.).
- Ensure directory context matches `Target Directory` before performing file modifications.

## [Preparation Phase]
1. Merge Strategy: Apply the `Conflict Strategy` chosen in Phase 1 without blindly overwriting existing files.
   - If `Smart Merge` is chosen but the target agent belongs to a different platform architecture, default to `Backup & Overwrite` to avoid cross-platform configuration conflicts.
2. Semantic Integrity: For Smart Merge, align updates with logical consistency, memory management, and verification guardrails while preserving original YAML frontmatter.

## [Action Phase: Generation]
3. Template Iteration: Process selected agents iteratively to manage context usage:
   - Read the corresponding template for each chosen role.
   - If merging into an existing file, read the target file first to preserve custom configuration.
   - Inject cognitive guardrails: role boundaries, shared memory references (`memory-keeper`), and outcome verification guidelines.
   - Align generated prompts with target platform capabilities (e.g. VS Code Copilot, Cursor, Claude Code) and appropriate task-tracking frameworks.
   - Substitute placeholders using the `Context Profile`. If a placeholder remains unresolved, insert a clear comment tag (e.g. `// TODO: Manual configuration needed`).
   - Save generated files to paths defined in `guidelines/platform-<platform>.md`.
4. Orchestrator Generation: Consult `guidelines/platform-<platform>.md` for Orchestrator requirements and update central prompts if necessary.

## [Summarize & Verification Phase]
5. Integrity Check: Verify generated files exist on disk before reporting completion.

## [Record: Exit]
6. Completion: Record successful subagent scaffolding.
7. Handoff: Load and execute `workflows/04-launcher.md`, passing the `Context Profile`, `Selected Agents`, and newly created file paths.