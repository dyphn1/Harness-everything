# Workflow: Using Git Worktrees

> Manages isolated workspace environments in parallel using native Git Worktrees, enabling developers to switch contexts safely without stashing or losing unsaved progress.

---

## 1. Skill Behavior Workflow

This section visualizes how the `using-git-worktrees` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Switch Context Needed]) --> CheckClean["Assess if main branch has uncommitted changes"]
  CheckClean --> CreateWorktree["Run git worktree add to a sibling directory"]
  CreateWorktree --> CheckoutTarget["Checkout target branch or create a hotfix branch"]
  CheckoutTarget --> OpenWorkspace["Open the sibling directory as a separate isolated workspace"]
  OpenWorkspace --> RunDev["Perform isolated edits, tests, and debugging"]
  RunDev --> CommitIsolated["Commit changes in the isolated workspace"]
  CommitIsolated --> RemoveWorktree["Prune and clean up the worktree path"]
  RemoveWorktree --> Return([Return to original workspace with pristine unsaved state intact])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `using-git-worktrees` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: worktree / isolate / checkout| WT["using-git-worktrees / SKILL.md"]
  WT -->|Maintains isolation before running tests in| TDDSkill["tdd / SKILL.md"]
  WT -->|Protects terminal environment testing in| EnvSkill["environment-detection / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `using-git-worktrees` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Working on deep feature 'feat-billing' (unstaged edits)"] --> Interrupt["Urgent production hotfix required!"]
  Interrupt --> Trigger["using-git-worktrees skill invoked"]
  Trigger --> CreateWT["Add worktree: 'git worktree add ../hotfix-auth hotfix-branch'"]
  CreateWT --> OpenWT["Open separate workspace editor in ../hotfix-auth"]
  OpenWT --> FixBug["Fix auth bug & run verification test"]
  FixBug --> CommitWT["Commit fix and push branch"]
  CommitWT --> CloseWT["Close editor, run 'git worktree prune'"]
  CloseWT --> Resume["Return to original billing workspace with all unsaved files exactly where they were"]
  Resume --> Done([Context switched safely with zero stashing friction])
```

---

## 4. Verification Check

To ensure that the `using-git-worktrees` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
