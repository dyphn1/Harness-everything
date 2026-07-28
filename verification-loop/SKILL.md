---
name: verification-loop
description: "A comprehensive verification system for Claude Code sessions."
author: Miya Daniel | Harness Core Team
version: 0.3.0
metadata:
  origin: ECC
---

# Verification Loop Skill

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Approaching task completion, milestone handoff, or PR creation. Input: Modified project files. |
| **Expected Output** | Objective verification metrics (Build, Type Check, Lint, and Test execution). |
| **State Mutations** | None. Read-only verification pass. |
| **Enforcement Gate** | Run relevant build, lint, and test suite tools. Ensure code checks pass cleanly before concluding execution. |

A comprehensive verification system for validating codebase stability before completing work.

**Evidence Assertion**:
Ground your Verification Report metrics (Build, Types, Lint, Tests, Security) in actual terminal execution outputs retrieved during the session.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

Adapt commands according to the project's ecosystem and active environment (`environment-detection`). Run commands directly without non-portable POSIX pipe assumptions (avoid raw `head`, `tail`, `grep`, `2>/dev/null` piping on Windows).

### Phase 1: Build Verification
```bash
# Check if project builds (JS/TS example)
npm run build
# OR
pnpm build
```

If build fails, STOP and fix before continuing.

### Phase 2: Type Check
```bash
# TypeScript projects
npx tsc --noEmit

# Python projects
pyright .
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Lint Check
```bash
# JavaScript/TypeScript
npm run lint

# Python
ruff check .
```

### Phase 4: Test Suite
```bash
# Run tests with coverage
npm run test -- --coverage

# Check coverage threshold
# Target: 80% minimum
```

Report:
- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

### Phase 5: Security & Code Hygiene Scan
Use native IDE search tools (`grep_search` / `file_search`) or cross-platform scripts rather than raw terminal `grep` pipes:
- Check for hardcoded API keys / secrets (`sk-`, `api_key`).
- Check for leftover debug log statements (`console.log`, `print`).

### Phase 6: Diff Review
```bash
# Show what changed
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases

## Output Format

After running all phases, fill in `verification-loop/templates/verification-report.template.md` with the actual results and present it.

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a component
- Before moving to next task

Run: /verify
```

## Integration with Hooks

This skill complements PostToolUse hooks but provides deeper verification.
Hooks catch issues immediately; this skill provides comprehensive review.
