# Workflow: Rewrite Commits

> Safely rewrites or squashes a specified range of commits into highly professional, Conventional Commits (Angular style) on a new branch.

---

## 1. Skill Behavior Workflow

This section visualizes how the `rewrite-commits` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Define Commit Range]) --> BackupBranch["Create a backup branch of current state"]
  BackupBranch --> ReadCommits["Read all commit messages in the range"]
  ReadCommits --> AnalyzeDiffs["Read files & diffs associated with each commit"]
  AnalyzeDiffs --> GenNewMessages["Generate high-quality Angular-style messages for each diff"]
  GenNewMessages --> SoftReset["Execute git reset --soft to merge range changes"]
  SoftReset --> ReapplyCommits["Re-apply changes with perfectly clean, segmented commit history"]
  ReapplyCommits --> VerifyBranch["Run verification checks on the final rebuilt branch"]
  VerifyBranch --> End([Perfectly clean Git history on new branch])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `rewrite-commits` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: commit / rewrite / squash| Rewrite["rewrite-commits / SKILL.md"]
  Rewrite -->|Supplements convention templates in| GitCommit["git-commit / SKILL.md"]
  Rewrite -->|Pre-verify rewritten commits via| VerLoop["verification-loop / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `rewrite-commits` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Branch has messy commits: 'fixed stuff', 'more fixes', 'bug'"] --> Trigger["Rewrite-commits skill run for HEAD~3"]
  Trigger --> Backup["Backup branch 'backup-feature-x' created"]
  Trigger --> GatherDiffs["Analyze total diff across the 3 messy commits"]
  GatherDiffs --> Generate完美["Determine changes relate to user auth session handling"]
  Generate完美 --> Rebuild["Reset and make 1 perfect commit: 'fix(auth): correct token refresh race condition'"]
  Rebuild --> Done([Clean, reviewable PR history ready])
```

---

## 4. Verification Check

To ensure that the `rewrite-commits` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
