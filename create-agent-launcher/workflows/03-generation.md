# Phase 3: Scaffold Generation

**[State Checkpoint]**
- MUST verify the inheritance of `Target Directory`, `Context Profile`, `Selected Agents`, and Phase 1 variables (`Platform`, `Conflict Strategy`, etc.).
- MUST ensure terminal is located at the `Target Directory` BEFORE file modifications.

## [Preparation Phase]
1. Merge Strategy: MUST NOT overwrite existing agents blindly. MUST apply the `Conflict Strategy` selected in Phase 1. 
   - IF `Smart Merge` is selected BUT the target agent belongs to a different platform architecture, MUST downgrade to `Backup & Overwrite` to prevent cross-platform hallucination.
2. Semantic Integrity: IF Smart Merge, MUST perform Semantic Refactor aligning with Logical Consistency, Long-Term Memory, Self-Adaptation, and Self-Verification. MUST preserve original YAML Frontmatter.

## [Action Phase: Generation]
3. Template Iteration: For EACH selected agent in `Selected Agents`, MUST NOT read all templates at once to prevent context dilution. MUST process them one by one:
   - MUST read the specific template.
   - IF `Conflict Strategy` is Smart Merge AND the target file exists, MUST read the existing file BEFORE merging to prevent hallucination.
   - MUST inject strict Cognitive Guardrails: MUST explicitly define Role Boundaries (refusing out-of-scope tasks), mandate the use of the Shared Memory Space (`memory-keeper`), and mandate deterministic outcome verification (no hallucinating success).
   - MUST align generation with platform-specific capabilities (e.g., VS Code LSP tooltips vs Cursor rules) and inject localized task-tracking/TODO frameworks tailored to the target platform and specific agent role (ensuring each agent and platform gets its own isolated, native TODO tracking system, e.g., mapping to `manage_todo_list` for VS Code, `.cursorrules` checklists for Cursor, or unique agent-scoped status JSONs).
   - MUST substitute placeholders using the `Context Profile`. IF a placeholder cannot be resolved, MUST NOT guess. MUST insert a conspicuous tag (e.g., `<<TODO: MANUAL_INPUT_REQUIRED>>` or localized `// TODO:` structured comments mapping to the active platform's task-tracking schema).
   - MUST write files securely to destination paths from `guidelines/platform-<platform>.md`.
4. Orchestrator Gen: MUST consult `guidelines/platform-<platform>.md` for Orchestrator requirements. MUST generate separate Orchestrator Instructions or update the root system prompt IF required.

## [Summarize & Verification Phase]
5. Integrity Check: MUST verify the generated files were written correctly to the disk by reading back portions or verifying their existence. Hallucinating success is forbidden.

## [Record: Exit]
6. Completion: MUST log successful Subagent generation.
7. Handoff: MUST execute `workflows/04-launcher.md` and pass the `Context Profile`, `Selected Agents`, and paths of the newly created files to ensure the entry point is explicitly generated in a dedicated mental phase.

[Exit: Await User Instruction]**'launch agent'** or describe your feature/task."