# Placeholder Reference

| Placeholder | Description | Example Values |
|------------|-------------|----------------|
| `{{PROJECT_NAME}}` | Human-readable project name | `Super H2O IDE`, `Gemini CLI`, `Super H2O VSCode Extension` |
| `{{KEY_SOURCE_PATHS}}` | Key source dirs (comma-separated, with descriptions) | `H2O.IDE/H2O.IDE/` (main IDE), `H2O.Common/` (shared utils), `H2O.Git2Sharp/` (VCS) |
| `{{AI_PLAN_PATH}}` | Path to the AI plans folder | `docs/ai_plans/` at main repo root |
| `{{FULL_BUILD_COMMAND}}` | Full project/workspace build | `./compile.sh`, `pnpm run build`, `dotnet build H2O.IDE.sln` |
| `{{LOCAL_BUILD_COMMAND}}` | Single project/package build | `dotnet build H2O.Git2Sharp.csproj`, `pnpm --filter gemini-cli build` |
| `{{CS_BUILD_COMMAND}}` | C# solution-wide build (polyglot only) | `dotnet build H2O.IDE.sln` |
| `{{TS_LOCAL_BUILD}}` | TypeScript single-package build (polyglot only) | `pnpm --filter h2o-cve-mcp-server build` |
| `{{TS_FULL_BUILD}}` | TypeScript workspace build (polyglot only) | `pnpm run build` |
| `{{PRIMARY_LANGUAGE}}` | Main language(s) | `C#`, `TypeScript`, `C# and TypeScript` |
| `{{MONOREPO_NOTES}}` | Monorepo structure description | `Super monorepo — all source code in level-1 git submodules; never commit source to main repo` |
| `{{AGENTS_DIR}}` | Path to agents directory | `.github/agents` |
