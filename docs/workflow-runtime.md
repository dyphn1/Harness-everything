# Selected workflow runtime

The selected applicable topology is mandatory. This contract governs lifecycle
obligations; agents still choose tools, reasoning, and implementation inside it.
Skill suggestions require individual applicability evaluation, not one universal
skill sequence. Git mutation isolation and durable multi-agent workspace state
are separate concerns.

## State and entry

`UserPromptSubmit` records `workflow-run.json` in the bound workspace's global
Harness session state. It includes a unique `workflowId`, complete plan, prompt
hash (no prompt text), revision count, and scoped exceptions. Unresolved work
survives follow-up/status prompts; a weaker route cannot erase it. A stronger
route blocks mutation until an explicit replan. A new task after `satisfied`
gets a new identity. Invalid recorded state fails closed with a diagnostic.

```text
pending -> running -> satisfied
              |          (only after required evidence)
              -> blocked -> start/replan (within budget)
```

`blocked` is a reportable incomplete outcome, never successful completion.
`deferred` means no topology has been selected. Legacy `active`/`escaped` records
remain subject to isolation and cannot supply a correlated run implicitly.

For Fable, write a stage array in the exact `workflow-stages.json` path displayed
by the router. This one file is allowed as runtime bootstrap data before entry;
the exception does not authorize changing workflow state or source artifacts.
Use the [stage schema](../fable-mode/CONTRACT-FORMAT.md); each stage needs an
objective `checkCommand` and `passCondition`. If the plan requires independent
verification, declare a read-only `fable-verifier` stage depending on every
other stage. Then run the displayed controller with the host session id:

```text
node "<hooks>/workflow-disposition.js" start --session-id "<session>"
```

The controller prepares the existing Fable consumer's run at the **bound** state
root, even when tool execution has moved to a linked worktree. The run records
both `workflowId` and `sessionId`; matching only strategy or creation time is
insufficient. `start` creates contracts, not agents. Fable retains ownership of
worker dispatch, dependency/write-set scheduling, and synthesis.

## Isolation boundary

Before Tier 3 or Fable source/artifact mutation, the gate verifies a registered
linked Git worktree with the same common Git directory as the bound repository.
It checks the tool's execution directory and actual Edit/Write/apply_patch paths,
including move destinations, relative traversal, and symlink/junction resolution.
Unknown direct targets, Git metadata, and nested repositories are rejected.
Read-only discovery and a literal `git worktree add` transition remain available
before entry. Prefer an already-ignored path or sibling path for setup; never
edit the primary tree's ignore file just to establish mandatory isolation.

Shell recognition is conservative: redirects, substitutions, chained commands,
and side-effect options are not accepted as read-only. Mutation-capable shell
execution requires an isolated working-directory field, with explicit outside
paths and directory changes rejected. **This is not a filesystem sandbox**:
arbitrary scripts, aliases/configuration, indirect variable paths, and races can
have effects a hook cannot infer. OS/host sandboxing is needed to contain them.
Agent-writable state is also not tamper-proof. These mechanisms prevent tested
bypasses; they do not establish durable containment against a malicious agent.

## Escape, replan, and completion

Escape names one stage in the correlated run and records the uncovered scope,
evidence, and `workflow-uncovered-scope` or `host-capability-unavailable` reason:

```text
node "<hooks>/workflow-disposition.js" escape --session-id "<session>" --stage-id "<stage>" --reason-code workflow-uncovered-scope --scope "<uncovered scope>" --evidence "<evidence>"
node "<hooks>/workflow-disposition.js" block --session-id "<session>" --evidence "<blocker>"
```

An escape never resolves the whole run, waives isolation, or removes independent
verification. Covered stages remain mandatory. Unavailable required verification
means blocked. The controller permits the initial run plus the plan's
`maxRevisionRounds` replans; exhaustion stays blocked. Previous run evidence is
retained, but cannot satisfy a replacement run.

`contract-test.js` records exact check commands, observed worker/session identity,
numeric exit code, and run/plan/stage evidence. A failed check can recover on a
later observed pass. A dependent check cannot pass before its prerequisites.
Stop enumerates the manifest's expected stages, so deleting a contract does not
make the run complete. A `pass` label without matching exit-zero evidence fails.
The independent verifier must have a distinct observed identity and evidence
after the latest mutation/check. This proves attribution, not reasoning quality.

Unresolved Stop exits 2. If the host marks a Stop retry, the contract becomes
`blocked` with diagnostics instead of looping indefinitely or recording success.
Direct/iterative routes use observed edit/verification milestones; iteration
counting and semantic check quality remain executor obligations, not proven by
these gates. Broad verification-command recognition is a heuristic.

## Host evidence

Claude's manifest carries the shell/direct-mutation and Stop hooks. The local
OpenAI package carries the same runtime for its declared `Bash|apply_patch`
surface. Package tests exercise both layouts. Missing worker/exit metadata keeps
Fable completion unresolved; it must be reported as degraded/blocked, not passed.
Manual CLI routing without a session cannot persist lifecycle state.

OpenCode and instruction-only/public Skills-only surfaces do not gain these
runtime gates from this change. An absent/disabled hook or deleted state cannot
be detected as an active contract by that same hook. No host compatibility status
is upgraded: see [platform capabilities](platform-capabilities.md). Live hook
loading, enforced host transitions, and behavioral improvement need separately
retained host traces and paired evaluations.
