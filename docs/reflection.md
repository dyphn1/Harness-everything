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
3.  **Memory vs. Dynamic Skill Judgment:** The model decides whether the insight is a simple, localized tip or a reusable, complex procedure — packaging every lesson as a skill would bloat context for no benefit, so this is a deliberate gate, not the default.
    *   **Simple Rule (default path):** Appended to local workspace rules (`RULES.md`, or a customized folder) via `persist-memory.js`.
    *   **Dynamic Skill (exception path):** Written as a standalone `SKILL.md` under `.claude/harness-everything/skills/generated/<name>/` per `skill-creator`'s Dynamic Skill Generation Contract (with `status: draft` lifecycle metadata and required `triggers:` keywords), then registered via `register-dynamic-skill.js` into `manifest.json`. From there, `tier-router.js` scans and auto-surfaces it in future sessions whenever its triggers match the prompt — closing the loop from "learned once" to "discovered automatically," not just recorded.
4.  **Self-Regression Validation:** Before any new rule or dynamic skill is persisted, Harness executes the `self-regression.js` test suite. This ensures that the generated rules/skills do not conflict with existing core rules and that all script syntax is 100% correct, preventing behavior decay.

---

## External Skills: A Deliberately *Different* Loop for Third-Party Content

`self-evolve`'s `generated[]` skills are self-authored — this workspace's own agent wrote them, `skill-creator` quality-gates them, and their lifecycle (`draft` → `active` → `deprecated`) is entirely Harness's to track. `find-skills` closes an adjacent gap — a capability that's neither in the static registry nor something this workspace has already learned, but that a third-party skill on `skills.sh` covers — and it was tempting to mirror `generated[]`'s exact mechanism for it (cache the skill's path + triggers in `manifest.json`, let `tier-router.js` auto-surface it the same way).

That mirroring was tried and deliberately reverted: `generated[]` is safe to cache because Harness owns the whole lifecycle behind it. A skill fetched via `npx skills add` has none of that guarantee — its author can update the `SKILL.md` at any time, or the user can run `npx skills update`/`remove` independently of Harness, and a cached copy of its `description`/`triggers` from install time would silently drift out of sync with no mechanism to notice. Caching it anyway would launder unaudited, unowned third-party content into the same trust tier as `generated[]`'s self-authored, quality-gated content — a category error, not just a missing feature.

So `find-skills` queries live instead of caching bookkeeping, and — a step further — defaults to never installing anything in the first place. `npx skills` already ships an ephemeral mode built for exactly this (`npx skills use <source>`): it fetches a skill and prints its content as a ready-to-follow prompt without installing it anywhere. `find-skills/scripts/use-skill.js` wraps that call behind a content-addressed cache under the OS temp directory (`os.tmpdir()/harness-find-skills-cache/<sha1-of-source>.md`, default 6h freshness) — a real fetch on first lookup, then zero network cost on repeat lookups of the same source, and nothing written to the repo, to a platform's native skill directory, or to `manifest.json`. When the OS eventually reclaims that temp directory, that's the entire "cleanup" story - no explicit expiry logic to maintain, because there was never any permanent state to expire.

Permanent install (`npx skills add`) still exists, but only as an explicit exception the user opts into when they know they'll reuse a skill across many future sessions - never the default `find-skills` reaches for. Checking `npx skills list` (§0.3 in `find-skills/SKILL.md`) only ever finds something from that rare path; the default ephemeral path never shows up there, by design, because it never installs. This is the actual answer to "won't skills pile up and bloat context over time?" - most borrowed knowledge is solved-once, applied-once, and leaves nothing behind. Only the deliberate minority a human chooses to keep ever accumulates, and that minority is small enough to stay legible without any Harness-side tracking.

---

## The Benefits of Self-Evolution

*   **Immunization:** The workspace is permanently "immunized" against recurring bugs.
*   **Team Alignment:** Because rules are checked into Git, every developer (and every AI agent they launch) immediately benefits from the shared, updated knowledge base.
*   **Token Efficiency:** Rather than the user repeatedly reminding the AI about custom project structures or conventions, the agent reads them natively from the immunized RULES file.
