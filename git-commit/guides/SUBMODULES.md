# Submodule Processing Workflow

**[State Checkpoint]**
- MUST verify the Main Repo absolute path transferred from the previous step.
- MUST ensure terminal is located at the Main Repo root BEFORE beginning discovery.

## [Discovery Phase]
1. Deep Discovery: MUST run `git submodule status --recursive` to find all Sub Repos.

## [Elimination Phase]
2. Evaluation: For EACH Sub Repo, MUST run `git diff --cached` securely to check for staged changes. IF NO staged changes exist, MUST eliminate from target list.

## [Execution Phase]
3. Generation: For Sub Repos WITH staged changes, MUST execute `COMMIT_GENERATION.md`.
4. Validation: MUST verify generation success. IF ANY Sub Repo has remaining staged changes, MUST diagnose failure and halt.

## [Indexing Phase]
5. Preference Check: MUST read `/memories/git-commit-prefs.md` for `auto_stage_submodules` setting.
6. Execution:
   - IF `auto_stage_submodules=true`: MUST run `git add <path>` in the Main Repo for all updated Sub Repos.
   - IF missing: MUST prompt user exactly: "[1] Yes, [2] No, [3] Yes & Always allow".
   - IF user selects [3]: MUST write `auto_stage_submodules=true` to `/memories/git-commit-prefs.md` AND run `git add <path>`.
   - IF user selects [1]: MUST run `git add <path>` in the Main Repo.
   - IF user selects [2]: MUST NOT run `git add`.

## [State Handoff]
7. Handoff: MUST summarize completed Sub Repo updates (including paths and logs) and explicitly carry them over when returning control to `SKILL.md`.