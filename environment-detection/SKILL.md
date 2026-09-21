---
name: environment-detection
description: Use at session start (Discover phase) to detect and align with the operating system, shell (Git Bash vs PowerShell vs CMD), package managers, and dev tools; prevents blind command execution and repetitive tool errors.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Environment Detection & Shell Alignment

Think > Try > Summarize > Record: detect before executing.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Session start or complex terminal sequences. |
| **Expected Output** | Detected OS, shell, PATH via script or heuristics. |
| **State Mutations** | Default: session context only. Explicit install/setup/repair may update Harness-owned platform touchpoints. |
| **Enforcement Gate** | Preflight; fall back to `<environment_info>` inspection and probing. |

Boundary: ordinary detection is read-only and stays inside `process.cwd()`. Never search unrelated workspaces, history, parent caches, or temp paths for a repair runtime.

## Workflow

1. Preflight from this skill's own directory; parse OS, shell, available CLIs: `node "<this-skill-dir>/scripts/preflight.js"`
2. Audit Harness touchpoints read-only where the local runtime supports it: `node "<this-skill-dir>/../harness-everything/scripts/self-heal.js" --check`. If that helper/runtime is unavailable, report the capability gap and continue; do not hunt for another copy.
3. Never run mutating self-heal during ordinary detection. Only explicit install/setup/repair intent may run the same helper without `--check`. OpenCode uses its own plugin runtime; skills-only surfaces may have no local repair surface.
4. Adopt syntax: Git Bash → forward `/`, `$VAR`, Unix cmds (`ls`, `rm -rf`), never `dir`/`del`/PowerShell · PowerShell → `$env:VAR`, cmdlets · CMD → `\`, `%VAR%`, `dir`/`del`/`copy`, never Unix.
5. On failure don't blindly retry — suspect wrong-shell syntax. Three failures → trigger `zoom-out`.

Deep dive: <this-skill-dir>/references/shell-syntax-rules.md

## USE FOR:
- session-start OS/shell/toolchain detection
- per-terminal command/path/env-var alignment
- read-only Harness integration audits
- explicit Harness repair when the user/task asks for setup or repair

## DO NOT USE FOR:
- implicit workspace repair during ordinary detection
- forcing the six-adapter installer onto OpenCode or skills-only surfaces
- operating outside the current workspace
- installing toolchains from scratch
