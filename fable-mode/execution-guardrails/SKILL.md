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
  author: Miya Daniel
  version: 0.3.4
---

# Execution Guardrails

## USE FOR:
- Raising a warning or flagging a suspected problem
- Search-and-replace or regex file edits
- Batching multiple minor caveats during a run
- Reporting capability limits

## DO NOT USE FOR:
- Task planning or fable-mode's staged loop
- Git history rewriting (see `rewrite-commits`)
- Skills that never raise warnings or edit files

## Core Rules

1. **Verify before flag** — Confirm a problem exists before reporting it.
2. **Warning threshold** — At three minor concerns, surface them all at once.
3. **Find-and-replace safety** — Prefer structured edit tools; anchor replacements with unique context; verify file integrity post-edit.

These rules are always-on, even when `fable-mode`'s staged loop is not running.

Deep dive: references/guardrail-rules.md
