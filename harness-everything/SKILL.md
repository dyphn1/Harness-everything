---
name: harness-everything
description: "Route software work through the Harness kernel, establish Tier 1/2/3 scope, preserve mandatory engineering invariants, then let the agent choose the smallest useful skill/tool set. USE FOR: \"triage a software task\", \"route this coding request\", or manually inspect/re-run Harness routing. DO NOT USE FOR: chat/general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.7
---

# Harness Everything

`harness-everything` is the public/manual entry point to the Harness kernel. On hosts with a prompt hook, the kernel should run automatically before peer/domain skill selection; this skill remains useful for explicit routing, debugging, and re-routing.

## USE FOR:
- Triage or re-route software/project work.
- Inspect the active Tier, invariants, and suggested skills.
- Recover when a host selected a domain skill directly and Harness routing was not established.

## DO NOT USE FOR:
- Chat or general Q&A.
- Non-software writing.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Software/project work, including work that already names or strongly matches another skill. |
| **Expected Output** | Tier + rationale, mandatory Harness invariants, then advisory skill suggestions. |
| **State Mutations** | None by routing itself. Domain skills may manage task state when useful. |
| **Enforcement Gate** | Run `<this-skill-dir>/scripts/kernel-router.js` before mutating software work unless the host hook already injected its output. |

## Minimal Kernel Invariants

1. **Route before execution** — establish task scope/tier before mutating work.
2. **Verify before claim** — completion claims require objective evidence appropriate to the change.
3. **Re-plan on repetition** — after three same-signature failures, stop micro-retrying and use `zoom-out`/fresh diagnosis.

These are mandatory rails. Skill choice and workflow order are not.

## Workflow

1. Reuse the current turn's Harness Kernel output when a hook already ran it; otherwise run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Preserve the listed invariants.
3. Treat routed skills as suggestions: choose, combine, reorder, or omit them according to the task and available host capabilities.
4. On `[Self-Heal]` warnings, run the named self-heal script.

## Routing Guidance

- **Tier 1:** Prefer direct execution; load a focused skill only when it adds value.
- **Tier 2:** `todo-driven-workflow`, `tdd`, and `verification-loop` are common suggestions, not a fixed pipeline.
- **Tier 3:** `fable-mode`, `fable-discipline`, and `multi-agent-workspace` are available for macro work when deliberate planning/delegation helps; they are not mandatory merely because the tier is 3.

**Architecture rule:** do not enforce workflow order. Enforce workflow invariants, then let the agent orchestrate itself.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
