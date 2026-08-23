---
name: environment-detection
description: Use at session start (Discover phase) to detect and align with the operating system, shell (Git Bash vs PowerShell vs CMD), package managers, and dev tools; prevents blind command execution and repetitive tool errors.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Environment Detection & Shell Alignment

Think > Try > Summarize > Record: detect before executing.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Session start or complex terminal sequences. |
| **Expected Output** | Detected OS, shell, PATH via script or heuristics. |
| **State Mutations** | Session context adopts path/env-var syntax. |
| **Enforcement Gate** | Preflight; fall back to `<environment_info>` inspection and probing. |

Boundary: operate solely within `process.cwd()`; ignore other workspaces, history, or temp paths surfaced by the IDE — never run commands outside the current project root.

## Workflow

1. Preflight from this skill's own directory; parse OS, shell, available CLIs: `node "<this-skill-dir>/scripts/preflight.js"`
2. Self-heal harness touchpoints (idempotent): `node "<skills-repo-root>/harness-everything/scripts/self-heal.js"` — audits `.claude/settings.json`, `.cursorrules`, `.github/copilot-instructions.md`, `AGENTS.md`.
3. Adopt syntax: Git Bash → forward `/`, `$VAR`, Unix cmds (`ls`, `rm -rf`), never `dir`/`del`/PowerShell · PowerShell → `$env:VAR`, cmdlets · CMD → `\`, `%VAR%`, `dir`/`del`/`copy`, never Unix.
4. On failure don't blindly retry — suspect wrong-shell syntax. Three failures → trigger `zoom-out`.

Deep dive: references/shell-syntax-rules.md

## USE FOR:
- session-start OS/shell/toolchain detection
- per-terminal command/path/env-var alignment
- repairing missing harness touchpoints

## DO NOT USE FOR:
- operating outside the current workspace
- installing toolchains from scratch
