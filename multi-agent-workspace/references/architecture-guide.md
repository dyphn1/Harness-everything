# Multi-Agent Workspace Architecture

The canonical skill combines two responsibilities that previously routed
independently: physical workspace scaffolding and specialist delegation.

```text
source catalog (optional)
        |
        v
validate divisions + frontmatter + revision
        |
        +--> global runtime/roles/agency-catalog.json --> explicit selection
        |
        v
shared resolver --> decision/domain/architecture paths in the workspace
        |
        +--> installed immutable skill + indexer --> global manifest/handoff
```

## Invariants

- The global workspace-keyed runtime is the generated boundary. The external
  catalog is read-only input and is never mutated.
- `state/`, `logs/`, and `roles/` are runtime data; decision/domain/architecture
  records resolve to committable workspace paths. Raw logs do not enter default context.
- The installed skill and indexer are immutable. Specialists receive a bounded brief and
  return `status`, `changes`, `verification`, `risks`, and `nextAction`.
- A source that is absent is represented as `agency.status: unavailable`; an
  unavailable source cannot be mistaken for a complete roster.
- A changed source revision is a migration event. Refresh only with
  `--allow-source-drift`, then review the new catalog and selection.
