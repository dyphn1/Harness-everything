# CLI / API Reference Template

Use this shape when the artifact is documenting a new or changed command surface — a CLI command, flag set, or a single API endpoint. Lighter than `feature-spec.md`: no user stories, no seam-sketching. Fits Tier 2 work just as often as Tier 3.

<spec-template>

## Synopsis

One-line usage form, e.g. `harness todo add <task> [--priority <n>]` or `POST /api/orders/:id/cancel`.

## Description

What this command/endpoint does and when you'd reach for it, from the caller's perspective.

## Flags / Arguments / Parameters

Each flag, positional argument, or request field: name, type, required/optional, default, what it controls.

## Examples

2-3 concrete invocations covering the common case and at least one edge case.

## Exit Codes / Errors

Every distinct exit code or error response: what triggers it, what the caller should do about it.

## Related Commands / See Also

Other commands/endpoints this one is commonly paired with, supersedes, or is superseded by.

## Contract Requirements

For every normative behavior this document owns, assign a stable requirement identity:

```md
### REQ-001 — <short behavior name>
**Status:** CURRENT
**Revision:** 1
**Decision lineage:** ADR-0001 (or None)
<observable command/API behavior or error contract>
```

Do not recycle requirement IDs. A changed caller-visible contract increments the revision before implementation completion.

</spec-template>
