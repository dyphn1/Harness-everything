# Self-Evolve — Memory Resolution & Execution Details

Details moved from SKILL.md. Read when you need the full decision matrix or the reasoning behind the cleanliness rules.

## Responsibility Boundary

The host agent owns access to the current session and any history explicitly exposed by the host. It selects authorized evidence and states a generalized root cause before invoking this skill. `self-evolve` classifies, deduplicates, validates, and persists that result. It MUST NOT scan global transcript stores, persist raw transcripts, or act as a transcript daemon.

## Triggers

- **Post-Circuit Breaker**: Following successful recovery after a `zoom-out` reflection.
- **Major Breakthrough**: Upon completing complex tasks that revealed non-obvious framework limits or architectural edge cases.
- **Explicit Request**: When the user asks to "remember this lesson" or "save this to memory".

## Execution Process & Memory Resolution Flow

```mermaid
flowchart TD
    Start[Evidence-backed lesson] --> Route[Harness router memory.write]
    Route -->|none| Reject[Reject durable write]
    Route -->|propose| Capability[Issue single-use workflow/session capability]
    Route -->|persist-via-self-evolve| Capability
    Capability --> Screen[Secret + injection + quality screening]
    Screen --> Similarity{Possible duplicate/paraphrase?}
    Similarity -->|yes| Candidate[Session-scoped review candidate]
    Similarity -->|no| Disposition{Effective disposition}
    Disposition -->|propose / active Fable run| Candidate
    Disposition -->|persist-via-self-evolve| Durable[RULES.md + memory-index.json]
    Durable --> Retrieve[Scoped deterministic retrieval]
    Retrieve --> Untrusted[Return as untrusted data/context]
```

For a simple rule, persist only the generalized constraint or tip. The router-issued capability is opaque, single-use, and bound to one workflow/session. Do not replace it with a free-form `--role` or `--session-id` claim. Active Fable runs remain candidate-only; durable promotion should happen through a later authorized coordinator/self-evolve path.

For a reusable multi-step procedure, load `skill-creator/SKILL.md`, create the draft skill, and use `register-dynamic-skill.js` to update each platform's `manifest.json` `generated[]` registry. The host agent remains responsible for deciding which evidence is relevant; these scripts do not discover session history.

## Memory Governance Rules

1. **Workflow authorization first**: `memory.write=none` rejects writes, `propose` writes only a session candidate, and `persist-via-self-evolve` is the only disposition eligible for durable rule persistence.
2. **No direct-append fallback**: file/shell edits to `RULES.md` bypass authorization, screening, retention, and metadata. If `persist-memory.js` cannot validate the runtime capability, stop instead of silently writing memory another way.
3. **Machine-readable metadata is authoritative for retrieval**: durable writes update `memories/repo/memory-index.json` with source, SHA-256, writer workflow/session, status, retention, and task/requirement/role scope. `RULES.md` remains the human-readable record.
4. **Retention is non-destructive**: stale, expired, and superseded records remain on disk for audit but are excluded from default retrieval.
5. **Scoped retrieval is fail-closed**: call `multi-agent-workspace/scripts/index_memory.js --retrieve --workspace <root> --task "<task>" [--requirement "<requirement>"] [--role "<role>"]`. No retrieval context returns no memory. Every included record is marked `untrusted-data` and cannot override higher-authority instructions or workflow contracts.
6. **Similarity is conservative**: likely duplicates or possible paraphrases become review candidates instead of silently deleting or duplicating durable memory.
7. **`self-regression.js` is not a persistence authorization gate**: it remains relevant only when changing this repository's own scripts/skills or registering a dynamic skill. Ordinary memory authorization comes from the current router/workflow capability plus `persist-memory.js` screening.


## Purpose

Through `self-evolve`, we transform "invalid trial-and-error", which might otherwise waste Tokens, into a valuable "moat" for the system. Even if the underlying model doesn't become inherently smarter, equipped with these memories, the system will automatically avoid known traps and break through its original reasoning ceiling.
