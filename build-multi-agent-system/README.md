# build-multi-agent-system (compatibility stub)

This legacy skill name is no longer routed independently. Its workspace
scaffolding and memory-index behavior moved to
[`multi-agent-workspace`](../multi-agent-workspace/SKILL.md), which also owns
specialist selection and bounded delegation.

Migration: replace `build-multi-agent-system` with `multi-agent-workspace` and
pass `--agency-source <path>` when an agency-agents catalog is available.
