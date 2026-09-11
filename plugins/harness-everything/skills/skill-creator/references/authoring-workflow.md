# Authoring Workflow Detail

Keep the Contract table as the source of truth for input, output, state, and
the enforcement gate. Use short ordered steps for actions and move branch-only
detail into references or guides.

Before registering a skill, check the Harness registry for overlap, define one
human-readable frontmatter description, run realistic with/without tests using
`multi-agent-workspace`, and complete the Quality Checklist. Static skills
belong in the root catalog and need a routing eval; dynamic skills use the
generated manifest flow from `self-evolve`.

The canonical multi-agent entrypoint is `multi-agent-workspace`; it owns
bounded delegation and workspace isolation.
