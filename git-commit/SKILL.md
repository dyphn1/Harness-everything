---
name: git-commit
description: Generates Angular-style commit messages after verifying the environment and staged files.
---

# Git Commit (Angular Style)

This skill is automatically triggered by the `harness-everything` router upon task completion or when the user explicitly requests "commit" or "save changes".

## 1. Triggers
- The final step of the TDD cycle (after Refactor is completed).
- Sub-task milestones within `fable-mode`.
- The user explicitly issues commands like "commit", "save changes", "git commit".

## 2. Environment Discovery & Prerequisite Defense `[Discover]`
Before generating a commit message, you **MUST** execute the following discovery:
- Run `git status` to check which files are staged or modified.
- **Circuit Breaker**: If no files are staged, ask the user if they want to stage the currently modified files; fabricating commit messages out of thin air is PROHIBITED.
- Check if working within a Submodule. If so, you MUST handle commits for the Main Repo and Sub Repo separately.

## 3. Commit Generation Discipline (Angular Style)
- Strictly follow the format: `<type>(<scope>): <subject>`.
- **Type**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- **Subject**: Short and concise, use the imperative, present tense (e.g., "add user auth", not "added user auth"), no capitalized first letter, no dot (.) at the end.
- **Body (if necessary)**: Explain "why" this change was made and the "root cause of the problem", rather than explaining what the code looks like.

## 4. Execution and Handoff `[Try] & [Summarize]`
- After confirming the commit message, call the terminal tool to execute `git commit -m "..." -m "..."`.
- Upon success, if still within the `fable-mode` workflow, hand control back to `fable-mode` to continue to the next milestone.
