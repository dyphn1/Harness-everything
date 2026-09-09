# Multi-Agent Workspace Router

This router is resolved from the installed `multi-agent-workspace` skill. Sub-agents MUST NOT modify it.

## Bootstrap Protocol

1. Read the task payload, then `{{RUNTIME_STATE}}`.
2. Read only the relevant document records:
   - decision records at `{{DECISION_PATH}}`
   - domain records at `{{DOMAIN_PATH}}`
   - architecture records at `{{ARCHITECTURE_PATH}}`
3. Read `{{LAUNCHER}}` and the selected roles before delegating.
4. Return a structured handoff with changed files and verification evidence.

## Boundaries

- Write working state to `{{RUNTIME_STATE}}`; keep raw output in `{{RUNTIME_LOGS}}`.
- Treat `{{ARCHITECTURE_PATH}}` and this router as immutable contracts.
- Delegate only the scope named in the launcher; never preload the external roster.
- If a specialist fails, report the failure and use a bounded fallback or human escalation.
