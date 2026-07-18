# Phase 2: Project Analysis

**[State Checkpoint]**
- MUST verify the inheritance of `Target Directory`, `Platform`, `Location`, `Resilience Features`, and `Conflict Strategy` from Phase 1.

## [Discovery Phase: Content Extraction]
1. Discovery Guide: MUST read `reference.md` for the discovery guide.
2. Target Scanning: MUST scan the `Target Directory` for `README.md`, `AGENTS.md` (or `CLAUDE.md`), and build files (e.g., `package.json`, `*.sln`).
3. Safe Extraction: For EACH discovered file, MUST read it securely and extract project name, tech stack, build commands, and architectural rules. IF a file does not exist, MUST skip it.
4. Abstraction: MUST synthesize the extracted data into a `Context Profile` to prevent context bloat.

## [Elimination & Evaluation Phase]
5. Stack Detection: MUST determine the exact tech stack from the gathered signals (e.g., `.csproj` implies C#).
6. Scope Limiting: MUST check for monorepo configuration (`pnpm-workspace.yaml`, `nx.json`).
   - IF it IS a monorepo, MUST use `vscode_askQuestions` to ask the user to specify the target package/app. MUST NOT attempt to scaffold agents for the entire monorepo universally.
7. Subagent Proposal: MUST propose specialist agents based on detected files (e.g., `.sh` implies Shell Expert). MUST NOT propose agents that duplicate core roles.

## [Action Phase: User Confirmation & Gap Analysis]
8. Selection: MUST use `vscode_askQuestions` to present a multi-select checklist of Subagents.
   - MUST include Core agents: Requirement Analyzer, Backend Developer, Task Verifier.
   - MUST include detected Specialist agents in the options.
9. Batch Requirements Check: AFTER selection, MUST quickly assess the chosen templates for required Placeholders (e.g., `{{DB_TYPE}}`). IF the `Context Profile` lacks this data, MUST explicitly ask the user in ONE batched question to fill the gaps.
10. Wait State: MUST wait for user to complete selection and variable input before proceeding.

## [Record: Handoff]
10. Handoff: MUST execute `workflows/03-generation.md` and explicitly pass the `Context Profile`, `Selected Agents`, and ALL Phase 1 variables.