---
name: execution-guardrails
description: >-
  Always-on guardrails: verify findings before flagging warnings, batch
  minor caveats, and anchor search-and-replace edits with post-write checks.
  Use when raising warnings or performing search-and-replace file edits.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Execution Guardrails

**USE FOR**: Raising warnings or flagging problems, search-and-replace/regex file edits, batching minor caveats, reporting capability limits.

| Component | Spec |
| :--- | :--- |
| **Trigger / Input** | Turn raising a warning or performing search-and-replace edits. |
| **Expected Output** | Verified warnings; batched caveats (3-item threshold); corruption-checked edits. |
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
2. **Warning threshold** — Batch minor concerns; surface them together at three (default). Material concerns do not wait.
3. **Find-and-replace safety** — Prefer structured edit tools over shell `sed`; anchor with unique context or `\bword\b` boundaries; verify file integrity post-edit. Never replace-all blindly.

These rules are always-on, even when `fable-mode`'s staged loop is not running.

Deep dive: references/guardrail-rules.md
