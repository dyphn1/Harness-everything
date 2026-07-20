# Workflow: Git Commit

> Generates semantic, Angular-style conventional commits after verifying the workspace, staged files, and active language contexts.

---

## 1. Skill Behavior Workflow

This section visualizes how the `git-commit` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Trigger Commit Hook / Command]) --> DetectRepo["Detect main repo vs submodule"]
  DetectRepo --> PreCheck["Verify unstaged changes & staged files"]
  PreCheck --> StageCheck{Staged files present?}
  StageCheck -->|No| Warning["Warn developer & exit"]
  StageCheck -->|Yes| DetectLang["Analyze file extensions for active languages"]
  DetectLang --> GenMessage["Analyze changes and generate Angular-style commit message"]
  GenMessage --> FormatCheck["Format check: type, scope, subject, body, footer"]
  FormatCheck --> WriteCommit["Commit staged files with formatted message"]
  WriteCommit --> End([Staging clean and committed])
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
