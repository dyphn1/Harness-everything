---
description: "Output example for create-agent-launcher applied to a fictional TypeScript npm-workspaces monorepo CLI project (Acme CLI). Shows the Context Profile from project discovery and the expected generated agent content."
---

# Example: TypeScript npm Monorepo CLI (Acme CLI)

This example shows what the Project Discovery step should extract from the project, and what the generated agent files should contain. **Acme CLI is a fictional project** — substitute your own project's real names, paths, and build commands.

---

## Input: Project Discovery Findings

After reading `README.md`, `AGENTS.md` (project-specific AI notes), and `package.json`, the LLM should record this Context Profile:

```
Project Name:       Acme CLI
Primary Language:   TypeScript / Node.js
Full Build Command: npm run build  (runs scripts/build.sh across all packages)
Local Build Command:npm run build -w packages/<package-name>
Key Source Paths:   packages/core/src/ (core agent logic),
                    packages/cli/src/ (CLI entry point and commands),
                    packages/vscode-companion/ (VSCode integration)
AI Plan Path:       docs/ai_plans/ at the repo root
Monorepo Type:      npm workspaces
Workspace File:     package.json (workspaces: ["packages/*"])
Special Constraints:Run 'npm run lint' after build. Integration tests in integration-tests/.
```

**Key signals discovered from README.md and package.json:**
- `"workspaces": ["packages/*"]` → npm workspaces monorepo
- `"build": "scripts/build.sh"` → custom build script (not bare `tsc`)
- `"lint": "eslint ."` → ESLint configured
- Packages: `@acme/cli` (CLI entry), `@acme/cli-core` (core logic)
- TypeScript config at root `tsconfig.json` and per-package

---

## Output: Generated Agent Files

**`requirement-analyzer.agent.md` — Approach section:**
```markdown
## Approach

1. **Analyze Requirements**: Review the requirements. Use `search` and `read` tools to
   gather context from the relevant packages: `packages/core/src/` (core logic, tools,
   and model integration), `packages/cli/src/` (CLI entry point, commands, and REPL),
   and `packages/vscode-companion/` (VSCode companion extension) as applicable.
2. **Handle Ambiguities**: Note critical ambiguities for the user; otherwise proceed.
3. **Document**: Save a detailed implementation document at `docs/ai_plans/` as
   `implement_<feature-name>.md` (e.g., `docs/ai_plans/implement_cli_auth.md`).
   Include:
   - Implementation Goals
   - Approach / Methodology
   - Detailed Implementation Steps
   - Implementation Details (classes, APIs, files, package paths)
   - Architecture Diagrams (if applicable)
```

**`backend-developer.agent.md` — full file:**
```markdown
---
name: "Backend Developer"
description: "Use when: you need to implement TypeScript/Node.js source code based on a requirement list or AI plan. This agent implements features and verifies them using 'npm run build'."
tools: [read, edit, search, execute]
---

You are an expert TypeScript/Node.js Developer working in the **Acme CLI** monorepo.
Your primary responsibility is to implement TypeScript source code strictly based on a
provided requirement list or AI implementation document.

## Approach

1. **Analyze Requirements**: Read the provided implementation document in `docs/ai_plans/`.
   Use `search` and `read` to understand the existing codebase in the relevant packages:
   `packages/core/src/` (core logic and tools), `packages/cli/src/` (CLI commands
   and REPL), and `packages/vscode-companion/` (VSCode integration).
2. **Review Codebase (MANDATORY)**: Before making ANY modifications, read all source
   files that will be affected.
3. **Implement**: Use the `edit` tool to modify or create TypeScript source code.
4. **Verify via Compilation/Linting — choose minimum scope**:
   - **Step 1 — Assess scope**: Did you only change files inside a single package (e.g., only
     `packages/cli/src/`)? → **Local build**. Did you change a shared type, a public export
     from `packages/core/`, or a root-level config? → **Full workspace build**.
   - **Local build** (single package, fastest):
     `npm run build -w packages/<package-name>`
     (e.g., `npm run build -w packages/cli`)
   - **Full workspace build** (when shared exports or cross-package types change):
     `npm run build` (runs the full `scripts/build.sh` pipeline)
   - **After any build**: Run `npm run lint` to ensure linting passes.
   - Prefer local build first. Escalate to full workspace only when the assessment above requires it.

## Constraints

- DO NOT modify the requirements. Your job is strictly implementation.
- You MUST thoroughly read all relevant existing files before writing any code.
- ALWAYS ensure the code compiles and lint passes before considering your task complete.
- Fix all compilation and lint errors before finishing.
```

**`agent-launcher/SKILL.md` — Project-Specific Notes section:**
```markdown
## Project-Specific Notes

- **Build verification**: `npm run build` (full workspace via `scripts/build.sh`)
  or `npm run build -w packages/<name>` for a single package
- **Lint**: Always run `npm run lint` after build
- **AI plan documents**: Save at `docs/ai_plans/implement_<name>.md` (or `fix_<name>.md`),
  repo-root-relative — never an absolute disk path
- **Primary language**: TypeScript / Node.js
- **Monorepo notes**: npm workspaces (`packages/*`). Key packages:
  `packages/core` (`@acme/cli-core`) and `packages/cli` (`@acme/cli`).
  Integration tests live in `integration-tests/`.
```

---

## Key Specificity Points

| Element | Expected in Generated Agent |
|---------|-----------------------------|
| Source paths | `packages/core/src/` (core logic), `packages/cli/src/` (CLI commands), with role annotations |
| Path style | Always repo-root-relative — generated agents must never contain absolute disk paths |
| Build scope decision | Assess scope first; prefer `npm run build -w packages/<name>` before escalating to full build |
| Lint requirement | Explicit: always run `npm run lint` after any build |
| Package identity | `@acme/cli-core` and `@acme/cli` (not just "the workspace") |
| AI plan example | `docs/ai_plans/implement_cli_auth.md` (real naming pattern) |
