# agency-agents source contract

`agency-agents` is an optional development-time source input. The merged skill
does not vendor its agent bodies or assume a machine-specific source path.

## Verified source snapshot

The local source used for issue 26 verification contains:

- 18 divisions and 258 Markdown agent files with YAML frontmatter.
- Source revision `3c9588880b7cafaec325a104899fd8bbe27e7d72`.
- Frontmatter keys observed across the roster: `name`, `description`,
  `color`, `emoji`, and `vibe`.
- 14 converter targets: `antigravity`, `gemini-cli`, `opencode`, `cursor`,
  `aider`, `windsurf`, `openclaw`, `qwen`, `zcode`, `kimi`, `codex`,
  `osaurus`, `hermes`, and `vibe`.

Counts and revision are evidence from the local checkout, not a promise that
future upstream revisions are identical. `scaffold.js` records the revision,
rejects empty divisions and duplicate names/slugs, and requires
`--allow-source-drift` before refreshing an existing generated catalog.

## Selection and provenance

Pass `--agency-source <path>` or set `AGENCY_AGENTS_SOURCE`. Use repeated
`--division` or `--agent` options to select roles; use `--all-agents` only when
the complete metadata catalog is deliberately needed. The generated catalog
stores metadata and relative source files, not specialist bodies. Load a body
on demand after a bounded brief has been assigned.

The upstream repository is [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents), licensed under MIT by AgentLand Contributors. Harness preserves that provenance; see `NOTICE-agency-agents.md` for the license notice.
