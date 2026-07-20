# Harness Routing & Task Triage

To prevent both over-engineering and under-planning, Harness classifies every user request into one of three execution tiers. This ensures that trivial tasks are executed instantly without unnecessary bloat, while complex architectural refactoring is strictly designed and verified.

---

## The Three-Tier Routing System

Upon receiving a request, the `tier-router.js` script analyzes the scope, affected files, and instruction patterns to route the task:

```
                  [ User Request ]
                         |
                         v
                [ Triage Analysis ]
               /         |         \
              /          |          \
     (Trivial)       (Standard)      (Macro)
     /                   |                  \
    v                    v                   v
[ Tier 1 ]           [ Tier 2 ]          [ Tier 3 ]
Direct Edit       Test-Driven (TDD)     Multi-Agent Flow
(No plans)        (Red-Green-Refactor)   (Fable-Mode)
```

### Tier 1: Trivial Tasks (Direct Execution)
*   **Trigger criteria:** Single-file edits, typos, simple styling fixes, readme corrections, or clean-up tasks.
*   **Behavior:** Harness bypasses plans, code-reviews, and sub-agents. The model is directed to make the edit directly and complete the task, consuming minimal tokens.
*   **Verification:** Basic syntax checks or a quick compile verify success.

### Tier 2: Standard Tasks (Test-Driven Development)
*   **Trigger criteria:** Normal feature requests, bug fixes, algorithm additions, API endpoint creations, or any task affecting multiple files with logical risk.
*   **Behavior:** Harness enforces the `todo-driven-workflow` base execution loop (initialize a 3-7 item verifiable checklist before editing, one item in-progress at a time) and the `tdd` skill. The model is strictly guided through the Red-Green-Refactor loop:
    1.  **Red:** Write an automated test first that reproduces the issue or covers the feature, then run it to verify failure.
    2.  **Green:** Implement the minimal amount of code to make the test pass.
    3.  **Refactor:** Polish the code, clean up duplicates, and ensure coverage targets (minimum 80%) are met.
*   **Verification:** Strict execution of the test suite.

### Tier 3: Macro Tasks (Multi-Agent/Fable-Mode)
*   **Trigger criteria:** High-level design changes, migration of modules, large-scale refactoring, or major capability additions affecting multiple domains.
*   **Behavior:** Harness automatically spawns the multi-agent orchestration engine (`fable-mode` and `create-agent-launcher`), with the macro plan materialized as the `todo-driven-workflow` checklist.
    1.  **Planning:** An agent constructs a rigorous, phase-based implementation plan.
    2.  **Delegation:** Specialized sub-agents (e.g., `security-reviewer`, `database-reviewer`, `code-reviewer`) are created to handle specific work streams or audits.
    3.  **Handoffs:** Session handoffs are saved periodically to ensure that if a session limits out or restarts, the progress is seamlessly restored.
*   **Verification:** Multi-layer unit, integration, and E2E verification loops.
