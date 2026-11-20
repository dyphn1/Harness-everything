# Harness OS Guidance (Advisory)

This file provides standardized advisory guidance for AI coding agents across all platforms.
For Claude Code users, this guidance is enforced via lifecycle hooks (hard enforcement).
For other platforms (Cursor, Copilot, Codex, Continue.dev, Hermes Agent), this is advisory only.

## Environment Alignment (Discovery over Assumption)

Before executing any command:
1. Detect your active shell (bash, zsh, PowerShell, cmd, fish)
2. Detect your operating system (Windows, macOS, Linux)
3. Detect your package manager (npm, yarn, pnpm, bun, pip, cargo)
4. Use only commands compatible with your detected environment

## Reassess when useful

An agent may use `zoom-out` when a meaningful signal contradicts a core assumption or exposes an unknown impact boundary. Productive attempts may continue when they yield new evidence or narrow the cause.

## Context Preservation (Anti-Bloat Protection)

- Avoid reading large files unnecessarily
- When output exceeds 500 lines, summarize key sections
- Prefer targeted searches (grep/glob) over reading entire files
- Clean up temporary files and outputs when done

## Self-Evolution (Continuous Workspace Memory)

When you resolve a complex issue:
1. Reflect on the root cause
2. Extract the lesson as a concise rule
3. Consider if this should be added to workspace rules
4. Prevent future regression by documenting the pattern

## Verification Discipline

Before claiming a change works:
1. Run the actual tests (don't just read the code)
2. Verify the fix works in isolation
3. Check for unintended side effects
4. Confirm the solution addresses the root cause, not just symptoms

## Token Efficiency

- Prefer targeted fixes over broad rewrites
- Use read-only tools (Read/Grep/Glob) before mutating tools
- Verify assumptions before implementing solutions
- Avoid unnecessary context loading

---

*This template ensures consistent guidance across all AI coding platforms.*
*For hard enforcement on Claude Code, see the lifecycle hooks in .claude/settings.json.*
