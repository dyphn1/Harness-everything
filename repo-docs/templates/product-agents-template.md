---
name: "product-agents-template"
description: "AGENTS.md template for end-user products (Full-stack apps, CLI tools, SaaS platforms). Provides AI agents with precise architecture, commands, conventions, and domain knowledge."
---

# {Product Name} - AI Developer Guide

> {One tight paragraph: technical summary of the product. E.g., "A full-stack React/Node.js application using PostgreSQL and MCP for agentic queries. Monorepo structure managed by pnpm." No marketing language.}

## Tech Stack & Architecture

- **Frontend**: {Framework, styling, state management. e.g., Next.js App Router, Tailwind, Zustand}
- **Backend**: {Language, framework. e.g., Node.js, Express/Hono}
- **Database**: {Database type and ORM. e.g., PostgreSQL via Prisma}

```
{abbreviated tree — key directories only}
```

| Directory | Purpose |
|---|---|
| `apps/frontend/` | {description} |
| `apps/api/` | {description} |
| `packages/core/` | {description} |

## Development Commands

All commands are executed from the repository root unless otherwise noted.

### Setup & Database
```bash
{install command e.g., pnpm install}
{env setup e.g., cp .env.example .env}
{database migration e.g., pnpm db:push}
```

### Local Development
```bash
{dev server command e.g., pnpm run dev}
```
- Frontend runs on: `http://localhost:{port}`
- API runs on: `http://localhost:{port}`

### Testing & Linting
```bash
{test command e.g., pnpm test}
{lint command e.g., pnpm lint}
```

### Build
```bash
{build command e.g., pnpm build}
```

## Conventions

- **Package Manager**: {e.g., Strictly use `pnpm`. `npm` and `yarn` will break resolution.}
- **Imports**: {e.g., Use absolute imports from `@/` in the frontend.}
- **Naming**: {e.g., PascalCase for React components, kebab-case for file names.}
- **State**: {e.g., Use Zustand for global state, avoid React Context unless necessary.}

## Product Domain Knowledge

{Briefly map product terminology to code concepts to help AI understand the business logic.}
- **{Domain Term 1}**: Handled entirely in `packages/core/src/term-1.ts`.
- **{Domain Term 2}**: Corresponds to the `Term2` database model in the Prisma schema.

## Do Not Edit

- `{generated file or dir}` — Auto-generated, do not edit manually.
- `{lock file}` — Managed by {tool} (e.g., `pnpm-lock.yaml`).
- `{build output dir}` — Ephemeral output.

## System Boundaries & Gotchas

- {Constraint 1: e.g., "The API server strictly requires the `DATABASE_URL` environment variable to start."}
- {Constraint 2: e.g., "Do not modify the `lib/generated/` folder; it is built on the fly during `pnpm dev`."}
- {Constraint 3: e.g., "If adding a new database table, you must run `pnpm db:generate` before testing."}
