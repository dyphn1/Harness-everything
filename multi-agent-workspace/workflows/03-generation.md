# Phase 3: Scaffold Generation

**[State Checkpoint]**
- Verify inheritance of `Target Directory`, `Context Profile`, `Selected Agents`, and Phase 1 variables (`Platform`, `Conflict Strategy`, etc.).
- Ensure directory context matches `Target Directory` before performing file modifications.

## [Preparation Phase]
1. Merge Strategy: Apply the `Conflict Strategy` chosen in Phase 1 without blindly overwriting existing files.
   - If `Smart Merge` is chosen but the target agent belongs to a different platform architecture, default to `Backup & Overwrite` to avoid cross-platform configuration conflicts.
2. Semantic Integrity: For Smart Merge, align updates with logical consistency, memory management, and verification guardrails while preserving original YAML frontmatter.

## [Action Phase: Generation]
3. Run `node multi-agent-workspace/scripts/scaffold.js --workspace <root>` with the selected source, divisions, agents, and platform.
   - Resolve document zones through the shared resolver; preserve the provenance of explicit, inferred, and fallback paths.
   - Migrate authored decision, domain, and architecture records only after checking every destination conflict.
   - Keep runtime metadata, roles, state, logs, and memory indexes under the global workspace-keyed state root.
   - Resolve the router template and indexer from the installed skill directory; render the router into the global runtime, never into the repository.
4. If the source is unavailable, retain the explicit unavailable-catalog status and do not claim a complete roster.

## [Summarize & Verification Phase]
5. Integrity Check: Verify the global manifest, handoff, launcher, selected roles, memory index, and resolved document paths before reporting completion.

## [Record: Exit]
6. Completion: Record successful subagent scaffolding.
7. Handoff: Load and execute `workflows/04-launcher.md`, passing the `Context Profile`, `Selected Agents`, and newly created file paths.
