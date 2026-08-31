---
name: harness-everything
description: "Triage new software requests into Tier 1/2/3 before work begins. USE FOR: \"triage a new software task\", \"route this coding request\". DO NOT USE FOR: \"chat or general Q&A\", \"non-software writing\", \"a skill is already indicated\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Harness Everything (System Main Entry & Dynamic Router)

## USE FOR:
- Triage new software tasks upfront

## DO NOT USE FOR:
- Chat / general Q&A — reply directly, no Checkpoint

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger** | New request, no skill indicated. |
| **Output** | Mandatory `🚦 Routing Checkpoint`. |
| **Mutations** | None; Tier 2/3 init todo workflow. |
| **Gate** | MUST run `scripts/tier-router.js` before edits. |

## Workflow

1. Unless a hook ran it: `node "<this-skill-dir>/scripts/tier-router.js" "<prompt summary>"`
2. Print the Checkpoint, execute by tier.
3. On `[Self-Heal]` warnings run `scripts/self-heal.js`.
4. Rule of 3 failures → `zoom-out` → `self-evolve`.

## 🚦 Harness OS Routing Checkpoint

- **Active Tier**: Tier X (Name)
- **Rationale**: 1-line router reason.
- **Routed Skills & Actions**: `path` (why)| Tier | Characteristics | Action |
| :--- | :--- | :--- |
| **1 Trivial** | Typos, single-function tweaks | Direct edit only; no plans/sub-agents/`fable-mode`. |
| **2 Standard** | One endpoint, bug, 2-3 files | `todo-driven-workflow` FIRST, context trace, `tdd`; gate: `verification-loop` (+`security-review`). |
| **3 Macro** | New project, architecture refactor | `fable-mode` + `fable-discipline`, explicit Haiku/Sonnet/Opus selector, sub-agents via `create-agent-launcher`; advisory `to-spec`/`to-tickets`. |

Deep dive: references/triage-and-tiers.md
