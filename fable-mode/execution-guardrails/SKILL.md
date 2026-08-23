---
name: execution-guardrails
description: >-
  Apply always-on operational guardrails on every task and model: verify
  findings before flagging warnings, batch minor caveats instead of
  interrupting piecemeal, and anchor search-and-replace edits to word
  boundaries with a post-write corruption check. Use whenever a turn would
  raise a warning or edit files via search-and-replace.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# Execution Guardrails

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Any turn about to flag a problem, raise a warning, or perform search-and-replace file edits. |
| **Expected Output** | Warnings grounded in verified findings; minor caveats batched at a 3-item threshold; edits context-anchored and checked post-write. |
| **State Mutations** | None of its own — governs execution quality for file-editing turns. |
| **Enforcement Gate** | Verify findings before raising warnings. Validate search-and-replace edits against corruption before presenting results. |

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

1. **Verify before flag** — Confirm a problem exists (grep, diff, run, check source) before reporting it. Never convert absence of evidence into a warning; web silence is not grounds for a warning about the user's firsthand world.
2. **Warning threshold** — Keep a running count of minor concerns. At three (default, tunable), surface them all at once before continuing. Material concerns do not wait for the threshold.
3. **Find-and-replace safety** — Prefer structured edit tools (`replace_string_in_file`) over shell `sed`; anchor replacements with unique context or `\bword\b` boundaries; verify file integrity post-edit. Never replace-all blindly.

These rules are always-on, even when `fable-mode`'s staged loop is not running.

Deep dive: references/guardrail-rules.md
