# Workflow: Git Commit

> Create clean Angular-style commit messages for an explicit commit request or a finished task phase, after checking repo state, submodules, and staged changes.

Source of truth: `git-commit/SKILL.md`.

## 1. Skill Behavior Workflow

```mermaid
graph TD
  CommitTrig([Commit requested or phase concluded]) --> StatusCheck[Run git status]
  StatusCheck --> RepoOk{Git repo present?}
  RepoOk -->|no| InitOffer[Offer git init or skip]
  RepoOk -->|yes| SubCheck[Check submodule changes per SUBMODULES guide]
  SubCheck --> SubDirty{Submodules changed?}
  SubDirty -->|yes| SubFirst[Commit submodules first]
  SubDirty -->|no| DiffCheck[Run git diff-cached]
  SubFirst --> DiffCheck
  DiffCheck --> StagedOk{Anything staged?}
  StagedOk -->|no| PromptStage[Prompt user and stage targeted files]
  StagedOk -->|yes| FormatMsg[Format type-scope-subject message]
  PromptStage --> FormatMsg
  FormatMsg --> VerifyLog[Commit then verify with git log -1]
  VerifyLog --> DoneClean([Tree updated and clean])
```

```mermaid
graph TD
  FormatSimple[Formatted Angular message] --> EscCheck{Simple single line?}
  EscCheck -->|yes| DirectM[git commit -m]
  EscCheck -->|no multiline or Windows| TempF[Write commit-msg file then git commit -F and cleanup]
  DirectM --> LogOne[git log -1 verifies commit]
  TempF --> LogOne
  LogOne --> CleanTree([Working tree clean])
```

## 2. Triggering and Routing Path

```mermaid
graph LR
  UserReq[User requests commit] --> GitSkill[git-commit SKILL]
  PhaseDone[Task phase concludes with staged diff] --> GitSkill
  GitSkill --> StatusGate[git status gate]
  StatusGate --> SubGuide[guides SUBMODULES.md if needed]
  SubGuide --> StyleGuide[guides ANGULAR_STYLE.md formatting]
  StyleGuide --> CommitVerify[Commit and git log -1 check]
```

## 3. Real-World Use Case

Developer finishes an auth fix and asks for a commit.

1. Run `git status`; if not a repo, offer `git init` or skip.
2. If submodules changed, commit those first per `git-commit/guides/SUBMODULES.md`.
3. Run `git diff --cached`; if nothing staged, prompt before staging targeted files.
4. Format `<type>(<scope>): <subject>` per `git-commit/guides/ANGULAR_STYLE.md`.
5. Use `git commit -m` for a simple line, or `.git-commit-msg.txt` + `git commit -F` with cleanup for multiline/Windows, then verify with `git log -1`.

```mermaid
graph TD
  DevDone[Auth fix finished and staged] --> CheckStatus[Run git status and cached diff]
  CheckStatus --> FmtMsg[Format feat-auth style message]
  FmtMsg --> PickMethod{Multiline or Windows?}
  PickMethod -->|no| CommitM[git commit -m]
  PickMethod -->|yes| CommitF[git commit -F with temp file]
  CommitM --> VerifyOne[git log -1]
  CommitF --> VerifyOne
  VerifyOne --> CleanDone([Committed and verified])
```

## 4. Verification Check

- [ ] `git status` ran first; non-repo offered `git init` or skip, and empty staging prompted the user instead of committing nothing
- [ ] Submodule changes were handled first per `git-commit/guides/SUBMODULES.md`
- [ ] Staged diff was reviewed with `git diff --cached`, with targeted staging only after confirmation
- [ ] Message followed `<type>(<scope>): <subject>` per `git-commit/guides/ANGULAR_STYLE.md`
- [ ] Multiline/Windows path used `.git-commit-msg.txt` + `git commit -F` with cleanup; simple path used `git commit -m`; result verified with `git log -1`
- [ ] No branch, rebase, merge, or push was performed, and no staging happened without confirmation
- [ ] Detail followed `git-commit/references/commit-flow.md` where needed
