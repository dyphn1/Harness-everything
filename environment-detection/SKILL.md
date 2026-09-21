---
name: environment-detection
description: Use at session start (Discover phase) to detect and align with the operating system, shell (Git Bash vs PowerShell vs CMD), package managers, and dev tools; prevents blind command execution and repetitive tool errors.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.16.6
---

# Environment Detection & Shell Alignment

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Session start or complex terminal sequences. |
| **Expected Output** | OS, shell, PATH, available CLIs. |
| **State Mutations** | Read-only by default; explicit repair may update Harness files. |
| **Enforcement Gate** | Preflight; fall back to `<environment_info>` and minimal probes. |

Boundary: stay inside `process.cwd()`. Detection never writes integrations or searches parent/cache paths for another runtime.

## Workflow

1. Run `node "<this-skill-dir>/scripts/preflight.js"`; detect OS, shell, CLIs.
2. Where supported, audit read-only: `node "<this-skill-dir>/../harness-everything/scripts/self-heal.js" --check`. If unavailable, report and continue.
3. Only explicit install/setup/repair intent may omit `--check`. Repair covers Claude, Codex, Copilot, Cursor, Continue, Hermes. OpenCode has its own plugin runtime; skills-only surfaces may lack repair.
4. Adopt shell syntax: Git Bash → `/`, `$VAR`, Unix commands; PowerShell → `$env:VAR`, cmdlets; CMD → `\`, `%VAR%`, Windows commands. Three repeated failures → `zoom-out`.

Deep dive: <this-skill-dir>/references/shell-syntax-rules.md

## USE FOR:
- session-start environment detection
- shell/path/toolchain alignment
- read-only audit or explicit repair

## DO NOT USE FOR:
- implicit repair during detection
- six-adapter repair on OpenCode/skills-only surfaces
- work outside the workspace or toolchain installation
