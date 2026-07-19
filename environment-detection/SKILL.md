---
name: environment-detection
description: Use at the very beginning of the session (Discover phase) to automatically detect and align with the operating system, terminal shell (e.g. Git Bash vs PowerShell vs Command Prompt), package managers, and development tools. Prevents blind command execution and repetitive tool-related errors.
---

# Environment Detection & Shell Alignment

## Core Principles
- **MUST** operate using the cognitive loop: Think > Try > Summarize > Record.
- **[Think]**: Before running any terminal commands, check your environment. Blind execution is the primary source of agent step waste.
- **[Try]**: Run the automated preflight check script to determine exact platform properties.
- **[Summarize]**: Output the detected terminal, OS, and toolchains so the session context retains these bounds.
- **[Record]**: Adopt the corresponding command syntax rules for the rest of the conversation.

## [State Checkpoint]
- Verify your environment details *before* executing commands or writing files.
- If you just started a session, run the preflight script immediately.

## [Discovery Phase: Environment Audit]
1. Run the preflight script to programmatically detect the system:
   ```bash
   node d:/GitHub/harness-skills/environment-detection/scripts/preflight.js
   ```
2. Parse the output and understand:
   - Operating System (Windows vs. macOS vs. Linux)
   - Active Shell (Git Bash vs. PowerShell vs. Command Prompt)
   - Available CLI Tools (node, pnpm, docker, python, etc.)

## [Execution Phase: Syntax and Command Alignment]
Choose the correct syntax matching your active shell:

### 1. Git Bash on Windows (User's Preferred Terminal)
- **Path Slashes**: Always use forward slashes `/` (e.g., `scripts/lib/utils.js`). Never use raw backslashes `\` because they act as escape characters in Bash.
- **Env Variables**: Use `$VARIABLE_NAME` syntax. Do NOT use `%VARIABLE_NAME%` or `$env:VARIABLE_NAME`.
- **Command Set**: Standard Unix commands are fully supported (`ls`, `rm -rf`, `mkdir -p`, `cp`, `mv`). Do NOT run CMD native commands like `dir`, `del`, or `copy`.
- **No PowerShell syntax**: Do not run PowerShell-specific scripts or syntax.

### 2. PowerShell on Windows
- **Path Slashes**: Forward slashes `/` or backslashes `\\` are both acceptable.
- **Env Variables**: Use `$env:VARIABLE_NAME` syntax.
- **Command Set**: Use standard PowerShell commands or common aliases (e.g., `New-Item`, `Remove-Item`).

### 3. Windows Command Prompt (CMD)
- **Path Slashes**: Use backslashes `\` for file paths.
- **Env Variables**: Use `%VARIABLE_NAME%` syntax.
- **Command Set**: Use `dir`, `del`, `copy`, `mkdir`. Do NOT use `ls`, `rm`, `cp`, `mkdir -p`.

## [Verification & Reflection Phase]
3. If any shell command fails, do **not** blindly retry the exact same command. 
4. Stop and ask yourself: "Did I use the wrong syntax for this terminal? Is this a Git Bash vs. PowerShell syntax issue?"
5. If you fail 3 times on the same command, trigger the `zoom-out` circuit breaker.

## Red Flags & Common Errors
- ❌ **CMD commands in Git Bash**: Attempting to run `dir` or `del` when the terminal is actually running Git Bash.
- ❌ **PowerShell commands in Bash**: Attempting to run `$env:PATH` or `.ps1` files in a Bash environment.
- ❌ **Path escape failures**: Sending raw Windows paths like `scripts\run.js` inside a Bash terminal, which interprets `\r` as a carriage return or escapes characters.
