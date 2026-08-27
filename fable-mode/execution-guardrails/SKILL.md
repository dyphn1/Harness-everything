---
name: execution-guardrails
description: Always-on operational guardrails: verify before flagging warnings, batch minor caveats, anchor search-and-replace edits with post-write corruption check.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# Execution Guardrails

## USE FOR:
- Raising warnings or flagging problems
- Search-and-replace/regex file edits
- Batching minor caveats
- Reporting capability limits

## DO NOT USE FOR:
- Task planning or fable-mode's staged loop
- Git history rewriting
- Skills that never raise warnings or edit files

## Core Rules

1. **Verify before flag** — Confirm a problem exists (grep, diff, run, check source) before reporting it. Never convert absence of evidence into a warning; web silence is not grounds for a warning about the user's firsthand world.
2. **Warning threshold** — Keep a running count of minor concerns. At three (default, tunable), surface them all at once before continuing. Material concerns do not wait for the threshold.
3. **Find-and-replace safety** — Prefer structured edit tools (`replace_string_in_file`) over shell `sed`; anchor replacements with unique context or `\bword\b` boundaries; verify file integrity post-edit. Never replace-all blindly.

These rules are always-on, even when `fable-mode`'s staged loop is not running.

Deep dive: references/guardrail-rules.md
