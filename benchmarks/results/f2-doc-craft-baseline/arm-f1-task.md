# Doc edit task (arm f1)

**Workspace:** `<paired>/arm-f1`. Work **only** inside it. No git or gh commands. Do not open any other copy of this repository.

## Task

This project uses Harness skills, whose source is inside the workspace. Start by reading `<paired>/arm-f1/harness-everything/SKILL.md`, and follow its guidance for editing a governed project document.

Edit `docs/doc-workflow-reconciliation.md`: make its opening explanatory paragraph (the first paragraph after the H1 title) clearer for a first-time reader. Keep every link, the frontmatter, and every factual or contract claim. Do not restructure the rest of the file.

When done, run whatever check the Harness guidance tells you to run for a governed doc, and fix anything it reports that your edit caused.

## Report

Write `<repo>/.worktrees/packets/feat-path/F2-P-f1-report.md` with these sections:
1. **Files read**, in order, with absolute paths. Include every file you opened.
2. **Paragraph before / after**, verbatim.
3. **Check run:** the exact command, the exit code and the full stdout.
4. **Guidance followed:** what you did because a Harness file told you to, naming the file.

The last line must be `STATUS: DONE` or `STATUS: BLOCKED: <reason>`.
