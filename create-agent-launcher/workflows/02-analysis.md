# Phase 2: Project Analysis

**[State Checkpoint]**
- Verify inheritance of `Target Directory`, `Platform`, `Location`, `Resilience Features`, and `Conflict Strategy` from Phase 1.

## [Discovery Phase: Content Extraction]
1. Discovery Guide: Read `reference.md` for guidance on repo scanning.
2. Target Scanning: Scan `Target Directory` for `README.md`, `AGENTS.md` (or `CLAUDE.md`), and build configuration files (e.g. `package.json`, `*.sln`).
3. Safe Extraction: Read discovered files to extract project name, tech stack, build commands, and architectural conventions. Skip missing optional files gracefully.
4. Abstraction: Synthesize extracted signals into a concise `Context Profile` to manage context window usage.

## [Elimination & Evaluation Phase]
5. Stack Detection: Determine the tech stack based on project files (e.g. `.csproj` for C#, `package.json` for Node/TS).
6. Scope Limiting: Check for monorepo configuration (`pnpm-workspace.yaml`, `nx.json`).
   - For monorepos, prompt the user to specify the target package/app rather than scaffolding blindly for the entire repository.
7. Subagent Proposal: Recommend relevant specialist roles based on detected files (e.g. Shell Expert if `.sh` scripts exist). Avoid duplicating core agent roles.

## [Action Phase: User Confirmation & Gap Analysis]
8. Selection: Present recommended Subagent options to the user (e.g. Requirement Analyzer, Backend Developer, Task Verifier, plus detected specialists).
9. Batch Requirements Check: Check selected templates for required placeholders (e.g. `{{DB_TYPE}}`). If missing from `Context Profile`, request missing inputs in one concise inquiry.

## [Record: Handoff]
10. Handoff: Load and execute `workflows/03-generation.md`, passing the `Context Profile`, `Selected Agents`, and all Phase 1 variables.