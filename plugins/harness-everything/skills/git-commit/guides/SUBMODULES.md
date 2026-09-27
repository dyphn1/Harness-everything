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

## [Reachability Phase]
Before staging any changed submodule gitlink in the Main Repo, MUST run the preferred deterministic check:

```bash
node <skills-repo-root>/using-git-worktrees/scripts/submodule-reachability.js --json
```

- Exit 0: continue to Indexing.
- Exit 1: MUST stop before staging and inspect the reported unreachable submodule(s); use the options below.
- Exit 2: MUST diagnose the inspection failure before staging.

If the helper is unavailable, use this raw fallback. First determine whether the Main Repo is a linked worktree:

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
```

If the git dir and common dir differ, then for EACH changed Sub Repo:

1. Identify the repository that **owns** the gitlink and the submodule path relative to that owner. For a direct submodule the owner is the Main Repo; for a nested submodule it is the immediate parent submodule. If this cannot be identified reliably, MUST stop and use the helper rather than guess.
2. Collect every commit that can affect the recorded gitlink, not only the current working HEAD:
   ```bash
   git -C <submodule> rev-parse HEAD
   git -C <owner> ls-files --stage -- <relative-submodule-path>
   git -C <owner> ls-tree HEAD -- <relative-submodule-path>
   ```
   From the last two commands, only mode `160000` stage `0` entries are valid gitlinks. Any stage `1`–`3` entry is unmerged and MUST stop. Check every unique SHA from working HEAD, index, and owner HEAD.
3. Check whether the Sub Repo is detached:
   ```bash
   git -C <submodule> branch --show-current
   ```
4. For EACH collected SHA, first check remote-tracking reachability:
   ```bash
   git -C <submodule> branch -r --contains <sha>
   ```
   If no remote-tracking ref contains it, prove that the **exact** primary-checkout submodule repository owns the object:
   ```bash
   git -C <primary>/<submodule> rev-parse --show-toplevel
   git -C <primary>/<submodule> cat-file -e <sha>^{commit}
   ```
   The reported top-level path MUST equal the expected primary submodule path. A missing/deinitialized nested path can make `git -C` fall back to a parent repository; that is not proof. If the exact primary submodule cannot be proven, initialize/fetch it or use the helper, otherwise MUST fail closed.

A branch name alone does not publish a commit. If ANY working/index/HEAD gitlink SHA has neither a containing remote-tracking ref nor a proven exact primary-submodule object, it is an **unpublished gitlink risk**, whether the submodule is detached or on a named branch. MUST stop before `git add <submodule>` and present:

- **[1] Create/publish a branch** — hand off to `<skills-repo-root>/using-git-worktrees/references/submodules-in-worktrees.md`.
- **[2] Stage anyway** — only on explicit user choice; MUST record the unpublished gitlink risk in the handoff.
- **[3] Abort** — do not stage the gitlink.

`git-commit` MUST NOT create branches or push as part of this gate. It only detects the risk and hands off to the worktree reference when publication is needed.

If the Main Repo is not a linked worktree, or the commit is already externally reachable, continue normally.

## [Indexing Phase]
5. Preference Check: MUST read the resolved Harness memory file `git-commit-prefs.md` for the `auto_stage_submodules` setting. Prefer an existing `MEMORY.md`/`RULES.md`; otherwise use `.github/harness-everything/memories/git-commit-prefs.md`.
6. Execution:
   - IF `auto_stage_submodules=true`: MUST run `git add <path>` in the Main Repo for all updated Sub Repos.
   - IF missing: MUST prompt user exactly: "[1] Yes, [2] No, [3] Yes & Always allow".
   - IF user selects [3]: MUST write `auto_stage_submodules=true` to the resolved Harness memory file AND run `git add <path>`.
   - IF user selects [1]: MUST run `git add <path>` in the Main Repo.
   - IF user selects [2]: MUST NOT run `git add`.

## [State Handoff]
7. Handoff: MUST summarize completed Sub Repo updates (including paths, commit SHA, publication/reachability evidence, and logs) and explicitly carry them over when returning control to `SKILL.md`.
