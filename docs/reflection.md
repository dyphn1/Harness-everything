# Harness Reflection, Memory & Self-Evolution

AI models are notorious for forgetting lessons learned in previous coding sessions. When a bug is solved, if the developer opens a new terminal or launches a new AI session, the agent may encounter the same environment quirks or framework gotchas and make the exact same mistakes again.

Harness solves this through its **Self-Evolution and Persistent Memory system**.

---

## The Transaction Log (WAL) & Session Handoff

Harness maintains a lightweight transaction log (analogous to a Write-Ahead Log in databases) via `hooks/scripts/state-persist.js`.

*   **Continuous Capture:** Every successful tool use or milestone is recorded in the session transaction log.
*   **Handoff File:** A session handoff checkpoint is saved in the workspace.
*   **Session Start Recovery:** Upon starting a new session, the `bootstrap.js` hook reads the handoff file. It automatically "wakens" the agent, restoring the previous task state, completed milestones, and pending actions. This completely eliminates "session restart amnesia."

---

## Long-term Memory & Workspace Rules

When a complex issue—such as an environment-specific bug, a unique framework quirk, or a custom build command requirement—is successfully resolved:

1.  **Deep Reflection:** Harness triggers the `self-evolve` skill, directing the model to reflect on the root cause and extract the exact pattern.
2.  **Rule Generation:** The model abstracts the learning into a concise rule (avoiding generic prompt prose).
3.  **RULES.md Integration:** The rule is appended or merged into local workspace rules (usually under a `RULES.md` or a customized folder).
4.  **Self-Regression Validation:** Before any new rule is persisted, Harness executes the `self-regression.js` test suite. This ensures that the generated rules do not conflict with existing core rules and that all script syntax is 100% correct, preventing behavior decay.

---

## The Benefits of Self-Evolution

*   **Immunization:** The workspace is permanently "immunized" against recurring bugs.
*   **Team Alignment:** Because rules are checked into Git, every developer (and every AI agent they launch) immediately benefits from the shared, updated knowledge base.
*   **Token Efficiency:** Rather than the user repeatedly reminding the AI about custom project structures or conventions, the agent reads them natively from the immunized RULES file.
