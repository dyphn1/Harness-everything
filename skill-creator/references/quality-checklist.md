# Quality Checklist (the actual gate)

## 3. Quality Checklist (the actual gate)

A skill isn't done until every line here is true. This is deliberately a flat checklist, not steps — check them in any order, but check all of them.

- [ ] **Skill Contract table present and accurate** — all four rows; Enforcement Gate names a real script/exit-code or an explicit "None" if the skill is pure reference.
- [ ] **Single source of truth**: the frontmatter `description` is the *only* place this skill's purpose is originally written. The registry row and any `tier-router.js` line quote or tightly paraphrase it — they don't independently re-describe the skill.
- [ ] **No block over ~5 lines duplicated verbatim elsewhere** — in this file or in another always/near-always-loaded skill. (`install-cognitive-os` vs. `harness-everything`'s 33-line ADHD-output block, flagged in the audit report, is the canonical counter-example — don't add a second one.)
- [ ] **Every `MUST`/`MUST NOT`/`PROHIBITED` has a real gate behind it**, or is rewritten as a positive statement of the target behavior. A prohibition with no gate and no "why" sentence next to it is a smell, not a strength.
- [ ] **No no-op lines** — for each imperative sentence, ask whether it changes behavior versus what the model already does by default. ("Be thorough" reads as a no-op; a concrete completion criterion or a stronger leading word doesn't.)
- [ ] **Body fits the information hierarchy** — steps for ordered action, flat reference for rules, detail past what every branch needs pushed to `guides/`/`references/` with a "when to open this" pointer.
- [ ] **Reuses existing leading words** (`Tier 1/2/3`, `circuit breaker`/`zoom out`, `Rule of 3`, `Red/Green/Refactor`, `Discover > Think > Try > Summarize > Record`) instead of naming a new concept for something this repo already has a word for.
- [ ] **Completion criteria are checkable** — tied to an exit code, a file's existence, a grep result, or explicit human confirmation, not "when it feels done."
- [ ] **Description reads as a human-facing sentence**, not just a trigger-phrase list — `scripts/installer.js`'s interactive picker prints it next to a checkbox for a person deciding whether to install this skill; that's its real first reader in this architecture (audit report §2.1).
