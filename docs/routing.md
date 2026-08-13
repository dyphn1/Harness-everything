# Harness Routing & Task Triage

To prevent both over-engineering and under-planning, Harness classifies every user request into one of three execution tiers. This ensures that trivial tasks are executed instantly without unnecessary bloat, while complex architectural refactoring is strictly designed and verified.

This is a default, not an order: `tier-router.js`'s own output tells the agent to follow its own read of the task when it clearly disagrees, and an explicit instruction from the Human Partner always wins. The keyword heuristic exists to catch the common case cheaply and deterministically, not to override judgment when it's wrong - the tier-router hook and the `zoom-out` step-back-and-retry loop are the safety net for when a hard call is actually needed, not the routing keywords themselves.

## Tuning the keyword heuristic

`tier-router.js` reads its keyword/guide tables from the sibling `harness-everything/scripts/routing-keywords.json` instead of hardcoding them. Edit that file directly to retune which prompts route to Tier 2/3 or surface a given knowledge guide - no code changes, no re-install, and it travels with `tier-router.js` automatically on every install/update since it lives in the same skill folder. Each `guideGroups` entry matches via a plain-substring `keywords` array (case-insensitive OR) or a `regex` source string; if the file is missing or hand-edited into invalid JSON, the router fails open (empty tables, Tier 1 default) instead of breaking the hook.

## Non-Software Task Bypass

If the user's prompt is non-software engineering (general Q&A, text translation, web searching, or conversational chat), Harness OS routing is **bypassed completely**. The model replies directly and naturally without emitting a Routing Checkpoint block.

---

## The Three-Tier Routing System

Upon receiving a software engineering request, the `tier-router.js` script analyzes the scope, affected files, and instruction patterns to route the task:

```
                  [ User Request ]
                         |
                 [ Software Task? ]
                /                  \
             (No)                  (Yes)
             /                        \
    [ Bypass Router ]          [ Triage Analysis ]
    Direct Response           /        |         \
                             /         |          \
                    (Trivial)      (Standard)     (Macro)
                    /                  |                 \
                   v                   v                  v
               [ Tier 1 ]          [ Tier 2 ]         [ Tier 3 ]
               Direct Edit      Test-Driven (TDD)    Multi-Agent Flow
               (No plans)      (Red-Green-Refactor)   (Fable-Mode)
```

### Tier 1: Trivial Tasks (Direct Execution)
*   **Trigger criteria:** Single-file edits, typos, simple styling fixes, readme corrections, or clean-up tasks.
*   **Behavior:** Harness bypasses plans, code-reviews, and sub-agents. The model makes the edit directly, emitting a brief single-line routing checkpoint or direct response.
*   **Verification:** Basic syntax checks or a quick compile verify success.

### Tier 2: Standard Tasks (Test-Driven Development)
*   **Trigger criteria:** Normal feature requests, bug fixes, algorithm additions, API endpoint creations, SRP object splitting, or security reviews affecting multiple files.
*   **Behavior:** Harness enforces the `todo-driven-workflow` base execution loop (prioritizing native IDE tools like `manage_todo_list`, falling back to `todo-cli.js` or `tasks/todo.md`) and the `tdd` skill. The model is strictly guided through the Red-Green-Refactor loop:
    1.  **Red:** Write an automated test first that reproduces the issue or covers the feature, then run it to verify failure.
    2.  **Green:** Implement the minimal amount of code to make the test pass.
    3.  **Refactor:** Polish the code, clean up duplicates, and ensure coverage targets are met.
*   **Verification:** Strict execution of the test suite and pre-delivery checks (`verification-loop`).

### Tier 3: Macro Tasks (Multi-Agent/Fable-Mode)
*   **Trigger criteria:** High-level design changes, migration of modules, large-scale refactoring, or major capability additions affecting multiple domains.
*   **Behavior:** Harness automatically spawns the multi-agent orchestration engine (`fable-mode` and `create-agent-launcher`), with the macro plan materialized via `todo-driven-workflow`.
    1.  **Planning & Alignment:** Perform grilling (`grill-me` / `grill-with-docs`), present an outline preview via `to-spec`, and publish formal specs or vertical-slice tickets (`to-tickets`).
    2.  **Delegation:** Specialized sub-agents (or inline persona role-switches) handle specific work streams or audits.
    3.  **Handoffs & Memory:** Milestone progress is saved to `todo-driven-workflow` state, and lessons learned are recorded via `self-evolve` (enforcing the 60-line cleanliness and lazy-loading rule).
*   **Verification:** Multi-layer unit, integration, and E2E verification loops (`verification-loop`).
