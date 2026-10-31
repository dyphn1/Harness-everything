# Doc edit task (arm f3)

**Workspace:** `<paired>/arm-f3`. Work **only** inside it. No git or gh commands. Do not open any other copy of this repository.

## Task

This project uses Harness skills, and their source is inside the workspace. Start by reading `<paired>/arm-f3/harness-everything/SKILL.md`, then follow its guidance for changing a governed project document.

The owner has decided that `docs/architecture.md` is now **deprecated**. Record that decision in the document's frontmatter, using the project's own status vocabulary for that document's role. Make no other content change.

Then do everything the Harness guidance and the project configuration require for this kind of change. Keep anything that depends on this document consistent. If the guidance requires running a command that the project declares, you are authorized to run it. When you finish, run whatever checks the guidance names, and fix anything they report that your change caused.

## Report

Write `<repo>/.worktrees/packets/feat-path/F3-P-f3-report.md` with these sections:
1. **Files read**, in order, as absolute paths.
2. **Files changed**, each with a one-line reason.
3. **Commands run**, each with its exact command line, exit code and trimmed stdout.
4. **Guidance followed**: what you did because a Harness file or the project config told you to, naming the file.

The last line must be `STATUS: DONE` or `STATUS: BLOCKED: <reason>`.
