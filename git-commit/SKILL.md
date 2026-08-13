---
name: git-commit
description: Generates Angular-style commit messages after verifying the environment and staged files.
author: Miya Daniel | Harness Core Team
version: 0.3.3
---

# Git Commit (Angular Style)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User explicitly requests a commit, or a task phase concludes. Input: Staged git diff. |
| **Expected Output** | Clean Angular-style commit created via `git commit -m` or temporary message file (`git commit -F`). |
| **State Mutations** | Git tree is updated. Workspace working tree becomes clean. |
| **Enforcement Gate** | Run `git status` first. If no files staged, prompt user before staging. On non-git repo, offer `git init` or skip. |

## Process & Commit Execution Flow

Follow the decision matrix below when committing changes:

```mermaid
flowchart TD
    Start[Trigger: Commit Request / Task Complete] --> CheckGit{1. Is Git Repo Initialized?}
    
    CheckGit -- No --> OfferInit[Prompt User: Run git init or Skip Commit]
    CheckGit -- Yes --> CheckSubmodules{2. Has Submodule Changes?}
    
    CheckSubmodules -- Yes --> CommitSubmodules["Commit Submodules First (Bottom-Up)<br>Consult git-commit/guides/SUBMODULES.md"] --> CheckStatus
    CheckSubmodules -- No --> CheckStatus[3. Run git status & git diff --cached]
    
    CheckStatus --> StagedCheck{4. Are Files Staged?}
    
    StagedCheck -- No Staged Files --> AskStage[Prompt User / Stage Targeted Files] --> Format
    StagedCheck -- Files Staged --> Format[5. Format Angular Commit Message]
    
    Format --> CheckShell{6. Shell / Multiline Escaping Check}
    
    CheckShell -- Simple Single Line --> DirectCommit["Run git commit -m 'type(scope): subject'"]
    CheckShell -- Multiline / Windows Shell --> TempFileCommit[Write .git-commit-msg.txt -> Run git commit -F -> Cleanup]
    
    DirectCommit --> VerifyCommit[Run git log -1 to Verify]
    TempFileCommit --> VerifyCommit
    VerifyCommit --> Done[Commit Complete]
```

## 1. Quick Workflow

1. **Verify State**: Run `git status` to inspect staged changes. If working inside submodules, handle submodule commits first by consulting `git-commit/guides/SUBMODULES.md`.
2. **Review Diff**: Run `git diff --cached` to understand the exact scope of changes.
3. **Format Message**: Follow the Angular commit convention (`<type>(<scope>): <subject>`). For detailed formatting rules, see `git-commit/guides/ANGULAR_STYLE.md`.
4. **Execute Commit**: Run `git commit -m "..."`.

## 2. Deep Reference Guides (Progressive Disclosure)
Load specific guides only when needed for complex commit scenarios:
- `git-commit/guides/ANGULAR_STYLE.md` — Conventional commit structure, types, and scope rules
- `git-commit/guides/COMMIT_GENERATION.md` — Message generation patterns and diff analysis tips
- `git-commit/guides/LANGUAGE_DETECTION.md` — Natural language conventions for commit subjects
- `git-commit/guides/MAIN_REPO.md` — Guidelines for monorepos and main repository commits
- `git-commit/guides/SUBMODULES.md` — Step-by-step handling for submodules and nested repos
