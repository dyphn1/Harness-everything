# Angular-Style Conventional Commits

**[State Checkpoint]**
- MUST verify the target language determined by Language Detection.

## Commit Message Format

```text
<type>(<scope>): <subject>

<body>

<footer>
```

## Field Definitions

1. **Type**: MUST be exactly one of: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
   - MUST use `style` or `chore` for trivial/formatting changes.
2. **Scope**: MUST enclose in parentheses if used.
   - For Sub Repos: MUST use the Sub Repo name.
   - For Code: MUST use a concise, high-level module name (e.g., `auth`, `ui`). MUST NOT use file paths.
3. **Subject**: MUST use imperative mood, present tense, maximum 50 characters, NO trailing period. MUST be in the target language.
4. **Body**: MUST describe motivation and context. MUST use bullet points. MUST NOT artificially wrap lines. MUST be in the target language.
5. **Footer**: MUST prefix breaking changes with `BREAKING CHANGE:`. MUST reference issues via `Closes #<id>`.

## Submodule Update Output Example

```text
chore(ui): update ui submodule

Core intent: Introduces dark mode support and resolves various UI layout issues.

Included commits:
- fix: align button text
- feat: add dark mode
- style: update primary color hex
- fix: resolve layout shift on mobile
```