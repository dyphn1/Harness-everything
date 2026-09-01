---
name: harness-everything
description: "Triage new software requests into Tier 1/2/3 before work begins. USE FOR: \"triage a new software task\", \"route this coding request\". DO NOT USE FOR: \"chat or general Q&A\", \"non-software writing\", \"a skill is already indicated\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Harness Everything

## USE FOR:
- Triage new software tasks before implementation.

## DO NOT USE FOR:
- Chat or general Q&A.
- Non-software writing.
- Requests that already name a skill.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | New software request with no skill indicated. |
| **Expected Output** | Print a Routing Checkpoint with tier and rationale. |
| **State Mutations** | None; Tier 2/3 starts native TODO or Markdown tracking. |
| **Enforcement Gate** | Run `scripts/tier-router.js` before edits. |

## Workflow

1. Unless a hook ran it, run `node "<this-skill-dir>/scripts/tier-router.js" "<prompt summary>"`.
2. Print the checkpoint and execute the selected tier.
3. On `[Self-Heal]` warnings, run the named self-heal script.
4. After three same-signature failures, use `zoom-out`, then `self-evolve`.

## Routing

- **Tier 1:** Trivial edits; direct edit only.
- **Tier 2:** Standard changes; use `todo-driven-workflow`, `tdd`, and `verification-loop`.
- **Tier 3:** Macro work; use `fable-mode` and `fable-discipline`, select Haiku/Sonnet/Opus via the model matrix, and delegate through `multi-agent-workspace`.

See `references/triage-and-tiers.md` for the full routing contract.
