# Multi-Agent Workspace Architecture

The canonical skill combines two responsibilities that previously routed
independently: physical workspace scaffolding and specialist delegation.

```text
source catalog (optional)
        |
        v
validate divisions + frontmatter + revision
        |
        +--> roles/agency-catalog.json --> explicit selection
        |
        v
six zones --> launcher.md --> bounded specialist handoff
        |
        +--> index_memory.js --> memory-index.md
        +--> AGENTS.md router + manifest.json
```

## Invariants

- `.harness/multi-agent/` is the generated boundary. The external catalog is
  read-only input and is never mutated.
- `state/`, `logs/`, `decisions/`, `domain/`, `architecture/`, and `roles/`
  have one semantic owner each. Raw logs do not enter default context.
- The generated router is immutable. Specialists receive a bounded brief and
  return `status`, `changes`, `verification`, `risks`, and `nextAction`.
- A source that is absent is represented as `agency.status: unavailable`; an
  unavailable source cannot be mistaken for a complete roster.
- A changed source revision is a migration event. Refresh only with
  `--allow-source-drift`, then review the new catalog and selection.
