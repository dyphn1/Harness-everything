# Workflow: Multi-Agent Workspace

`multi-agent-workspace` is the single routed entrypoint for permanent
multi-agent infrastructure. It combines the former launcher and workspace
scaffold responsibilities and adds an optional agency-agents metadata source.

```text
Discover target + source
        |
Validate divisions, frontmatter, names, slugs, revision, platform
        |
Scaffold .harness/multi-agent/
  state / logs / decisions / domain / architecture / roles
        |
Write router + catalog + selected roles + launcher + handoff
        |
Run generated index_memory.js -> memory-index.md
```

## Selection contract

Use `--agency-source <path>` or `AGENCY_AGENTS_SOURCE`. Select by repeated
`--division` or `--agent`; `--all-agents` is explicit and metadata-only. The
generated launcher lists each selected role's division, source-relative file,
description, and boundary. Specialist bodies are loaded only on demand after a
bounded brief is assigned.

## Failure contract

No source creates a visible `agency.status: unavailable` fallback. Invalid
frontmatter, missing or empty divisions, duplicate names/slugs, unknown
agents, and unsupported platforms fail before output is written. A changed
source revision requires `--allow-source-drift` to refresh a Harness-owned
catalog. Existing generated artifacts require `--force` only when they are
not identical.

## Handoff

The launcher and `handoff.json` require `status`, `changes`, `verification`,
`risks`, and `nextAction`. The immutable generated router directs agents to
the six zones and forbids router edits. Fable remains responsible for macro
planning; TDD remains responsible for ordinary feature implementation.
