# Schema / File Format Template

Use this shape when the artifact is documenting a data shape — a database schema change, a config file format, a wire payload, or an on-disk state file. Lighter than `feature-spec.md`: no user stories, no seam-sketching.

<spec-template>

## Purpose

What this schema represents and why it exists, in one or two sentences.

## Shape

Every field: name, type, required/optional, constraints (enum values, ranges, format). A snippet is appropriate here — schemas are exactly the case where inlining the shape beats describing it in prose.

## Versioning / Migration

How a previous version maps to this one, if this is a change rather than a new schema. Whether old readers/writers still work, and for how long.

## Validation Rules

Constraints that span multiple fields, or that a type system alone can't express (e.g. "end_date must be after start_date").

## Backward Compatibility

What breaks for existing consumers, if anything, and what the mitigation is (dual-write, expand-contract, feature flag).

## Example Payload

One realistic, complete example instance of the schema.

</spec-template>
