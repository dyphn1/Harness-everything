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

## Circuit Breaker Rule (Rule of 3)

If you encounter the same error 3 times:
1. **STOP.** Do not attempt a 4th variation.
2. Re-read the error message carefully - don't guess what it says.
3. Check the actual file contents (don't assume you know them).
4. Consider: is this a syntax error, logic error, environment issue, or missing dependency?
5. Try a fundamentally different approach.
6. If still stuck after reflection, escalate to your Human Partner with a clear decision request.

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