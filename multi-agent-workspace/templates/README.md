# Placeholder Reference

Example values below use the fictional projects from `examples/` (Contoso Workbench, Acme CLI). Always substitute the target project's real values discovered during Project Discovery — and keep every path repo-root-relative (never an absolute disk path).

| Placeholder | Description | Example Values |
|------------|-------------|----------------|
| `{{PROJECT_NAME}}` | Human-readable project name | `Contoso Workbench`, `Acme CLI` |
| `{{KEY_SOURCE_PATHS}}` | Key source dirs (comma-separated, with descriptions) | `Workbench.App/Workbench.App/` (main app), `Workbench.Common/` (shared utils), `Workbench.VcsBridge/` (VCS) |
| `{{AI_PLAN_PATH}}` | Path to the AI plans folder | `docs/ai_plans/` at main repo root |
| `{{FULL_BUILD_COMMAND}}` | Full project/workspace build | `./compile.sh`, `pnpm run build`, `dotnet build Workbench.sln` |
| `{{LOCAL_BUILD_COMMAND}}` | Single project/package build | `dotnet build VcsBridge.csproj`, `pnpm --filter @acme/cli build` |
| `{{CS_BUILD_COMMAND}}` | C# solution-wide build (polyglot only) | `dotnet build Workbench.sln` |
| `{{TS_LOCAL_BUILD}}` | TypeScript single-package build (polyglot only) | `pnpm --filter @acme/mcp-server build` |
| `{{TS_FULL_BUILD}}` | TypeScript workspace build (polyglot only) | `pnpm run build` |
| `{{PRIMARY_LANGUAGE}}` | Main language(s) | `C#`, `TypeScript`, `C# and TypeScript` |
| `{{MONOREPO_NOTES}}` | Monorepo structure description | `Super monorepo — all source code in level-1 git submodules; never commit source to main repo` |
| `{{AGENTS_DIR}}` | Path to agents directory | `.github/agents` |
