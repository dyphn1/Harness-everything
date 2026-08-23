# Dynamic Skill Generation Contract (for self-evolve)

## 4. Dynamic Skill Generation Contract (for `self-evolve`)

`self-evolve`'s Step 3 optionally packages a hard-won session insight into a new, standalone skill. This process **MUST** only occur if the LLM has judged that the lesson warrants an independent, complex structural skill rather than a simple memory rule:

- **The Judgment Criterion**: Simple constraints or localized tips **MUST** only be written to `memories/repo/RULES.md`. Only highly generalizable, multi-step procedures or custom enforcement contracts (e.g. transaction pooling patterns) should be packaged as a dynamic skill.
- **Location**: `.claude/harness-everything/skills/generated/<kebab-case-name>/SKILL.md` — not the repo root. `.claude/harness-everything/skills` is already a scope the installer recognizes (`scripts/lib/skills.js`'s `getInstalledSkills`), which keeps dynamically-generated skills discoverable without mixing them into the reviewed, static skill set at the repo root. `generated/` is deliberately excluded from the installer's manifest-tracked, bulk-removable skill set — these are the user's own accumulated learning, not package content, so "uninstall skills" must never sweep them.
- **Required frontmatter**, in addition to `name`/`description`:
  ```yaml
  triggers: [<3-6 specific keywords a real prompt would contain, EN and/or 中文 — not generic words like "error" or "using">]
  metadata:
    type: dynamic
    generated: <YYYY-MM-DD>
    source: <one-line pointer to the session/root-cause that produced it, e.g. "zoom-out recovery, 2026-07-22, ORM connection-pool exhaustion">
    status: draft
  ```
  `triggers` is what `tier-router.js` matches against to auto-surface this skill in future sessions — pick words specific enough to the actual problem domain (e.g. `connection-pool`, `transaction-batching`), not words generic enough to fire on unrelated prompts. Omitting this field falls back to `register-dynamic-skill.js`'s naive keyword inference from the name/description, which is intentionally conservative and a worse signal than a deliberate list — don't rely on it.
- **Gate**: run the Quality Checklist (§3) before the skill file is written. A dynamic skill skips human PR review by design, so this checklist is the only review it gets — don't skip it because the insight "feels obviously right" in the moment; that's exactly the state self-evolve is triggered from.
- **Lifecycle**: `status: draft` at birth. Promote to `status: active` once it fires successfully in a *different* task than the one that produced it — a skill that has only proven itself on the bug that spawned it hasn't proven generality yet. If a dynamic skill goes unused or stops matching reality, mark `status: deprecated` rather than deleting it silently — deleting is fine once something else supersedes it, but a silent disappearance is harder to debug later than a stale-but-labeled file.
- **Promotion to static**: once a dynamic skill has proven itself general — used successfully across genuinely unrelated tasks, not repeated instances of the same bug — promote it: move it to the repo root, drop the `metadata.type: dynamic` block, and register it in `harness-everything/SKILL.md` §5 like any other skill. At that point it's subject to the same review/PR discipline as everything else here.
