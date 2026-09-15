# Harness Routing & Task Triage

Harness classifies software work into three tiers to prevent both over-engineering and under-planning. **The tier is a scope recommendation, not a workflow pipeline.**

The current architecture follows one rule:

> **Do not enforce workflow order. Enforce workflow invariants.**

A strong model should be free to decide how to complete the task. Harness protects only the small set of behaviors that must not disappear when the host chooses a peer/domain skill directly.

## Kernel invariants

For software/project work, Harness establishes three mandatory rails before mutation:

1. **Route before execution** — establish task scope/tier.
2. **Verify before claim** — completion requires objective evidence appropriate to the change.
3. **Re-plan after repeated failure** — after three same-signature failures, stop micro-retrying and use a fresh diagnosis / `zoom-out`.

Skill selection, ordering, planning style, and delegation remain agent decisions unless the user or an authoritative project contract explicitly requires them.

## Public routing path

```text
kernel-router.js
  ├─ delegates classification / guide discovery → tier-router.js
  ├─ preserves tier + rationale + dynamic-skill recommendations
  ├─ suppresses legacy fixed-pipeline wording
  ├─ emits required invariants
  └─ emits advisory skill suggestions
```

Use:

```bash
node harness-everything/scripts/kernel-router.js "<prompt>"
# or
npx github:dyphn1/Harness-everything next "<prompt>"
```

On a host where `UserPromptSubmit` is wired, reuse the hook output instead of running it twice.

## Non-software bypass

General Q&A, translation, ordinary web search, and non-software writing bypass Harness routing. The model should answer directly and naturally.

A software prompt that already says "use TDD", "security review", `repo-docs`, or another skill **does not bypass the kernel**. Host skill routing and Harness routing are different layers: the kernel establishes cross-cutting invariants; the host/model selects useful expertise.

## Three-tier recommendation model

```mermaid
flowchart TD
    U([User Request]) --> S{Software / project work?}
    S -- No --> B[Bypass Harness]
    S -- Yes --> K[Harness Kernel<br/>scope + invariants]
    K --> T{Tier recommendation}
    T -- Tier 1 --> A[Agent self-orchestrates]
    T -- Tier 2 --> A
    T -- Tier 3 --> A
    A --> E[Execute selected tactics / skills]
    E --> V{Evidence supports completion?}
    V -- Yes --> D([Done])
    V -- No --> R[Diagnose and iterate]
    R --> F{Same failure x3?}
    F -- No --> E
    F -- Yes --> Z[Zoom out / re-plan]
    Z --> E
```

### Tier 1 — Trivial

Typical triggers: typos, narrow single-file edits, straightforward cleanup, code explanation, simple Git operations.

Guidance:
- prefer direct execution,
- avoid large plans/delegation,
- load a focused skill only when it adds value,
- still gather enough evidence to support the completion claim.

### Tier 2 — Standard

Typical triggers: normal feature work, bug fixes, multi-file changes, security review, focused benchmark/evaluation.

Possible suggestions:
- `todo-driven-workflow` when explicit progress tracking helps,
- `tdd` when executable behavioral tests are a useful design/verification tool,
- `verification-loop` when systematic build/lint/test/diff selection helps,
- `security-review` for trust/input/auth/secrets/network boundaries,
- `using-git-worktrees` where isolation reduces workspace risk,
- `eval-harness` for quantitative scoring.

None of those imply a universal `TODO → TDD → verification-loop` sequence.

### Tier 3 — Macro

Typical triggers: repository-wide refactors, architecture/migration work, large ambiguous requirements, broad documentation/system design, or work that may benefit from delegation.

Possible suggestions:
- `fable-mode` / `fable-discipline` for deliberate macro planning,
- `multi-agent-workspace` for bounded delegation,
- `repo-docs` for project-level documentation,
- `grill-with-docs`, `to-spec`, and `to-tickets` when design decisions/specs/issues genuinely help.

Tier 3 does **not** automatically mean multi-agent. If one capable agent can complete the work safely and efficiently, direct execution is valid.

## Classifier tuning

`tier-router.js` reads keyword/guide tables from `harness-everything/scripts/routing-keywords.json`. Edit that data to tune Tier 2/3 signals or knowledge-guide matches without changing classifier code.

The classifier remains heuristic:
- its recommendation is the default, not an order,
- a clear task reading may override it,
- explicit user intent wins,
- when overriding a materially different tier, record the reason briefly.

## Pre-action `actionGate`

The router may predict that a request needs `workflowPlan.actionGate`, but the Phase 5 enforcement hook deliberately **re-classifies the exact tool payload**. A missing or incorrect router prediction therefore cannot authorize a destructive command.

The executable policy lives in `hooks/scripts/action-gate-rules.json`. A missing or invalid table activates built-in safety defaults and reports the degradation. A valid empty table remains empty so the CI negative control can detect accidental policy erasure.

| Exact tool action | Harness result | Audit disposition before execution |
|---|---|---|
| Safe unmatched command such as `git status` | allow/no decision | no gate record |
| Matched command on Claude Code (default policy) | no decision: the session's permission mode, rules and auto-mode classifier decide | `deferred-to-host` |
| Matched command on Claude Code with `HARNESS_ACTION_GATE_POLICY=always-ask` | `permissionDecision: "ask"` | `pending-approval` |
| Matched command on a host without Harness-verified ask semantics | block with exit 2 | `rejected` |
| Payload reaches `PostToolUse` | continue | `executed` with exact payload SHA-256 |
| Payload reaches `PostToolUseFailure` | continue | `executed` + failed execution outcome |
| Deferred or pending payload never executes before `Stop` | no execution | `rejected` |
| Hook internal error | Claude: no decision plus a `systemMessage` warning (`always-ask`: `ask`); other/unverified host: exit 2 | host decides on Claude; fail closed elsewhere |

`rm -rf` and `Remove-Item -Recurse -Force` are exempt only when every parsed target is inside the OS temp directory, the current session scratch directory, or an explicitly supplied Harness scratch directory. An uncertain target is gated conservatively.

```mermaid
flowchart TD
    P[PreToolUse exact payload] --> C{Matches action-gate rule?}
    C -- No --> A[Allow without gate record]
    C -- Yes --> X{Scratch-only destructive delete?}
    X -- Yes --> A
    X -- No --> H{Host has a native permission flow?}
    H -- Claude Code --> Y{always-ask policy?}
    Y -- No --> D[No decision: the permission mode decides<br/>record deferred-to-host + payload hash]
    Y -- Yes --> Q[Emit permissionDecision: ask<br/>record pending-approval + payload hash]
    H -- No / unknown --> B[Exit 2 block<br/>record rejected]
    D --> U{Did the exact tool payload execute?}
    Q --> U
    U -- PostToolUse --> E[record executed]
    U -- PostToolUseFailure --> F[record executed + failure]
    U -- no execution by Stop --> R[record rejected]
```

On Claude Code the gate returns no decision by default. The [hooks reference](https://code.claude.com/docs/en/hooks) says a hook's `ask` "also forces a permission prompt in auto mode: the classifier can still deny the tool call, but it can't approve the call silently". A forced `ask` would therefore override the permission mode the user picked (#107).

With no decision, the normal permission flow applies:

- Manual and `acceptEdits` prompt unless a rule or the mode already allows the command.
- Auto mode lets the classifier decide.
- `dontAsk` denies anything that is not pre-approved.
- Deny rules apply in every mode.

Set `HARNESS_ACTION_GATE_POLICY=always-ask` to have Harness force its own prompt instead. Either way the gate classifies and audits every matched payload.

The deterministic suite verifies two things: the deferred result for every known `permission_mode` value, and the `ask` JSON under `always-ask`. That is **mechanism evidence only** until preserved live evidence exists.

## Cognitive OS relationship

`install-cognitive-os` remains the canonical explanatory/manual entry point for Discover → Think → Try → Summarize → Record. It is **not** required to win peer-skill selection before domain work begins. The runtime kernel establishes the smaller invariant contract independently; domain skills provide their own tactics inside that contract.

## Enforcement strength

A lifecycle hook can mechanically inject/guard supported invariants. Instruction-only integrations can only advise the model. Do not label advisory behavior as hard enforcement, and do not infer cross-host parity from shared skill text alone.
