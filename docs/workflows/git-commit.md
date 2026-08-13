# Workflow: Git Commit

> Generates semantic, Angular-style conventional commits after verifying the workspace, staged files, and active language contexts.

---

## 1. Skill Behavior Workflow

This section visualizes how the `git-commit` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Trigger Commit Request / Task Complete]) --> CheckGit{Is Git Repo Initialized?}
  CheckGit -->|No| OfferInit["Prompt User: Run git init or Skip Commit"]
  CheckGit -->|Yes| CheckSubmodules{Has Submodule Changes?}
  
  CheckSubmodules -->|Yes| CommitSubmodules["Commit Submodules First (Bottom-Up)"] --> CheckStatus
  CheckSubmodules -->|No| CheckStatus["Run git status & git diff --cached"]
  
  CheckStatus --> StageCheck{Are Files Staged?}
  StageCheck -->|No| AskStage["Prompt User / Stage Targeted Files"] --> FormatMessage
  StageCheck -->|Yes| FormatMessage["Format Angular Commit Message"]
  
  FormatMessage --> CheckShell{Shell / Multiline Escaping Check?}
  CheckShell -->|Simple Single Line| DirectCommit["Run git commit -m 'type(scope): subject'"]
  CheckShell -->|Multiline / Windows| TempFileCommit["Write .git-commit-msg.txt -> Run git commit -F -> Cleanup"]
  
  DirectCommit --> VerifyCommit["Run git log -1 to Verify"]
  TempFileCommit --> VerifyCommit
  VerifyCommit --> End([Staging Clean and Committed])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `git-commit` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: commit / git / save| GitCommit["git-commit / SKILL.md"]
  GitCommit -->|Formats according to| Guide["git-commit / guides / ANGULAR_STYLE.md"]
  GitCommit -->|Integrates with pre-commit gates| VerLoop["verification-loop / SKILL.md"]
  GitCommit -->|Composed after history squashes| Rewrite["rewrite-commits / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `git-commit` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Developer completes feature & runs 'git add .'"] --> Trigger["Invoke git-commit skill"]
  Trigger --> Analyze["Skill parses staged diff: 'src/auth.js (+15,-2)'"]
  Analyze --> DetectScope["Deduce scope: 'auth' and type: 'feat'"]
  DetectScope --> BuildMessage["Build message: 'feat(auth): add JWT token expiration check'"]
  BuildMessage --> Commit["Execute git commit -m 'feat(auth): add JWT token expiration check'"]
  Commit --> Done(["Repository index updated cleanly"])
```

---

## 4. Verification Check

To ensure that the `git-commit` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
