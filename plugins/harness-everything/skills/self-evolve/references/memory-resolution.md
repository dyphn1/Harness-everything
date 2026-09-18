# Self-Evolve — Memory Resolution & Execution Details

Details moved from SKILL.md. Read when you need the full decision matrix or the reasoning behind the cleanliness rules.

## Responsibility Boundary

Harness may observe only its own structured runtime events. Rule-of-3 recovery and verifier fail→pass transitions can create privacy-minimal lesson candidates automatically; raw prompts, commands, tool output, source text, and global host transcripts are not copied into those candidates. The agent or Human Partner still supplies the generalized rule before evaluation. `self-evolve` MUST NOT scan global transcript stores, persist raw transcripts, or act as a transcript daemon.

## Triggers

- **Post-Circuit Breaker**: Following successful recovery after a `zoom-out` reflection.
- **Major Breakthrough**: Upon completing complex tasks that revealed non-obvious framework limits or architectural edge cases.
- **Explicit Request**: When the user asks to "remember this lesson" or "save this to memory".

## Execution Process & Memory Resolution Flow

```mermaid
flowchart TD
    Runtime[Harness-owned recovery evidence] --> Opportunity[Learning opportunity]
    Opportunity --> Candidate[Lesson candidate: proposed]
    Candidate --> Screen[Generalized rule + safety/quality screening]
    Screen --> Eval{Evidence class}
    Eval -->|objective verifier fail→pass| Accepted[accepted for governed promotion]
    Eval -->|linear recovery / insufficient replay| Hold[inconclusive]
    Eval -->|unsafe/weak| Reject[rejected]
    Accepted --> Auth[#134 single-use memory capability]
    Auth --> Durable[RULES.md + memory-index.json]
    Durable --> Retrieve[Scoped deterministic retrieval]
    Retrieve --> Outcome[retrieved → validated / regressed / superseded]
```

The versioned candidate contract is `<this-skill-dir>/schemas/lesson-candidate.schema.json`. Runtime creation records only structured IDs/hashes/status transitions. Candidate states are distinct from effectiveness claims: `accepted` means the evidence is grounded enough to permit governed memory promotion, while `evaluation.improvementClaim` remains false until #71/later recurrence evidence supports a behavioral claim.

For a simple rule, inspect/list the session candidate, evaluate it with a generalized constraint or tip, and promote only an `accepted` candidate. The router-issued capability is opaque, single-use, and bound to the authorizing workflow/session; that promotion session may differ from the original recovery session and both provenances remain recorded. Do not replace the capability with a free-form `--role` or `--session-id` claim. Active Fable runs remain candidate-only; durable promotion happens through a later authorized coordinator/self-evolve path.

For a reusable multi-step procedure, load `skill-creator/SKILL.md`, create the draft skill, and use `register-dynamic-skill.js` to update each platform's `manifest.json` `generated[]` registry. The host agent remains responsible for deciding which evidence is relevant; these scripts do not discover session history.

## Candidate Lifecycle

```text
observed -> proposed -> screened -> evaluated
                              -> accepted -> persisted -> retrieved
                              |                         -> validated
                              |                         -> regressed
                              |                         -> superseded
                              -> rejected
                              -> inconclusive
```

- `rule-of-3-recovery` is intentionally non-replayable from one linear trace and remains `inconclusive` until paired/later recurrence evidence exists.
- `verifier-fail-pass` can pass deterministic grounding checks because the retained contract records an objective fail→pass transition, but this still does not prove future behavioral improvement.
- Identical runtime evidence is idempotent and maps to one candidate ID.
- Runtime hooks can create candidates but cannot call the durable memory writer directly.
- Record later evidence explicitly with `lesson-candidate.js observe --outcome retrieved|validated|regressed|superseded --evidence "<ref>"`; outcome transitions never happen merely because a rule exists.

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
