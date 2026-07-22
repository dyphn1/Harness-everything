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
4. **Body**: MUST describe motivation and context, and MUST analyze the staged changes to list the exact modifications in a clear, structured bulleted list.
   - MUST analyze the `git diff --cached` output to extract the specific files, functions, or logic modified.
   - MUST list each major change or file-level modification with a brief description of "what was changed" (e.g., `- Updated user schema to support OAuth IDs in src/models/user.ts`).
   - MUST NOT separate bullet points with blank lines.
   - MUST NOT artificially wrap lines.
   - MUST be in the target language.
5. **Footer**: MUST prefix breaking changes with `BREAKING CHANGE:`. MUST reference issues via `Closes #<id>`.

## Code Change Output Example

```text
feat(auth): add OAuth2 login support

Core intent: Allows users to sign in using Google and GitHub to simplify user authentication.

Changes:
- Added OAuth2 client config schema and defaults in `config/auth.ts`
- Implemented OAuth2 middleware verification pipeline in `src/middleware/oauth.ts`
- Updated user database model to store external provider IDs in `src/models/user.ts`
- Added comprehensive integration tests for external provider flows in `tests/auth.test.ts`
```

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
- style: update primary color hex
- fix: resolve layout shift on mobile
```