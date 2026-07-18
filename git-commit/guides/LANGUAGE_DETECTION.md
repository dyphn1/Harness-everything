# Language Detection Workflow

**[State Checkpoint]**
- MUST verify terminal access to the target repository.

## [Discovery Phase]
1. Memory Check: MUST read `/memories/git-commit-prefs.md` for a cached target language.

## [Evaluation Phase]
2. Sampling: IF memory cache is missing, MUST run `git log -n 5` securely to sample recent commit languages.
3. Language Determination:
   - IF a non-English language is detected dominantly in recent commits, MUST update `/memories/git-commit-prefs.md` with this language.
   - OTHERWISE, MUST default to English.

## [Record: Handoff]
4. Handoff: MUST record the determined target language into the state context and return control to the Commit Generation workflow.