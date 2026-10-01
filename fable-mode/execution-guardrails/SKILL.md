---
name: execution-guardrails
description: >-
  Reference guardrails for verified warnings, batched minor caveats, and
  anchored search-and-replace edits. Active carriers must copy or inject
  these rules explicitly.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.2
---

# Execution Guardrails

> **Reference-only nested contract.** Claude Code does not discover this directory as a standalone skill from the `fable-mode` manifest entry. These rules take effect only when an active host-visible carrier copies or injects them; Fable agent prompts carry the required rules inline.

**USE FOR**: Raising warnings or flagging problems, search-and-replace/regex file edits, batching minor caveats, reporting capability limits.

| Component | Spec |
| :--- | :--- |
| **Trigger / Input** | Turn raising a warning or performing search-and-replace edits. |
| **Expected Output** | Verified warnings; batched caveats without count-based stops; corruption-checked edits. |
| **State Mutations** | None — governs execution quality for file-editing turns. |
| **Enforcement Gate** | Verify before flagging; validate edits post-write. |

## USE FOR:
- Raising a warning or flagging a suspected problem
- Search-and-replace or regex file edits
- Batching multiple minor caveats during a run
- Reporting capability limits ("this may be beyond me")

## DO NOT USE FOR:
- Task planning, staging, or fable-mode's staged loop itself
- Git history rewriting (see `rewrite-commits`)
- Skills that never raise warnings or edit files

## Core Rules

1. **Verify before flag** — Confirm a problem exists before reporting it. Never convert absence of evidence into a warning.
2. **Warning batching.** Collect minor concerns and list them together in the next natural report or handoff; their count alone MUST NOT stop, pause, or return the worker/stage. An independently material, confirmed concern may stop the current stage and be surfaced immediately.
3. **Find-and-replace safety** — Prefer structured edit tools over shell `sed`; anchor with unique context or `\bword\b` boundaries; verify file integrity post-edit. Never replace-all blindly.

Repeated matching execution failures remain governed by Rule-of-3 / `zoom-out`; warning batching never substitutes for that recovery path.

These rules are intended for reuse outside `fable-mode`, but this nested file is not an always-on carrier. They apply only where an active host-visible skill, agent prompt, hook, or instruction layer has copied or injected them.

Deep dive: <this-skill-dir>/references/guardrail-rules.md
