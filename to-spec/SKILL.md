---
name: to-spec
description: Turn the current conversation into a written spec — a feature PRD, CLI/API reference, schema doc, or dev doc, whichever shape actually fits — and publish it per this repo's own harness-everything/manifest.json projectDocs framework. No interview beyond pinning that framework down once; otherwise just synthesis of what's already been decided.
author: Miya Daniel | Harness Core Team
version: 0.3.0
disable-model-invocation: true
---

# To Spec

Synthesizes the current conversation and codebase understanding into a written artifact. Do **NOT** interview the user about the feature itself — that is `grill-me`/`grill-with-docs`'s job, run *before* this skill. The only interview this skill ever runs is the one-time Step 0 framework setup below, and only when the mechanized check says it's missing.

Not every task needs a PRD. This skill carries four starting skeletons under `templates/` and picks (or blends) the one that matches what's actually being built, so the same skill covers a macro feature, a new CLI flag, a schema change, or a small design decision — without forcing a heavyweight document on a lightweight task.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit `/to-spec` invocation (never auto-run — publishing has a real side effect). Input: the current conversation plus whatever `CONTEXT.md`/ADRs/grilling already settled. |
| **Expected Output** | One published doc using whichever `templates/*.md` skeleton fits the artifact — adapted, not filled in verbatim — placed per the repo's `projectDocs` entry (see Step 0). |
| **State Mutations** | The `projectDocs` field inside this repo's own `<platform>/harness-everything/manifest.json` (the same file `scripts/lib/manifest.js` and self-evolve's `generated` skill registry already own) — written only via `check-project-docs.js init`, never hand-edited, only when the check gate says it's missing/incomplete. Plus the doc/issue itself, at the location that entry specifies. |
| **Enforcement Gate** | MUST run `node "<this-skill-dir>/scripts/check-project-docs.js" check` before Step 1. Exit 0 → read the entry, proceed. Exit 1 → run the Step 0 interview for the missing field(s), then persist with `init` — do not proceed to Step 1 on a failing check. MUST NOT re-interview the user about feature content already settled by a prior `grill-me`/`grill-with-docs` pass or plainly stated in conversation. For the `feature-spec` shape, MUST confirm seams before publishing. This skill itself is never a gate on anything else — `tdd`/`verification-loop` never wait on it. |

## Process

### 0. Check the project docs framework (mechanized gate)

Three things affect every later step and every future `to-tickets` run on this repo: **where reference docs live**, **how issues are tracked**, and **what counts as a valid issue** here. Don't re-derive these from scratch, and don't re-ask once they're known — check first:

```bash
node "<this-skill-dir>/scripts/check-project-docs.js" check
```

This reads/writes a `projectDocs` object inside `<platform>/harness-everything/manifest.json` (e.g. `.claude/harness-everything/manifest.json`) — the file this package already uses for its install manifest and for `self-evolve`'s generated-skill registry. No new `docs/` config file, no second place to look. It's deliberately **repo-local only**: the script never touches the global `~/.agents`/`~/.claude` manifest homes, because doc location / tracker / issue definition are per-repo facts — writing them to a global, cross-project file would leak one repo's tracker into every other repo sharing that install.

- **Exit 0** → some platform home in this repo already has a complete `projectDocs` entry. Read it and skip straight to Step 1.
- **Exit 1** → missing or incomplete (stdout names which field). Run the interview below for only the flagged field(s).

**`projectDocs` is a pointer, not a payload.** `manifest.json` is read on *every* `tier-router.js` invocation — every prompt in this repo, not just `/to-spec` runs — so it must stay small. `init` enforces this: each field is capped at 200 characters, and passing a longer value is rejected before anything is written. Each answer below should be one short line; if the real answer is genuinely elaborate (a multi-context doc map, a full custom issue template), write that detail into its own file and pass just its path as the field's value. Any future need to log something per-session or per-doc (e.g. which doc was published for which conversation) belongs in a separate, session-scoped state file — never appended into this manifest.

**The interview** (one round, not a grilling session — this is setup, not feature discovery):

1. **Document Location** — where do reference docs (schema docs, CLI references, dev docs, ADRs) live in this repo? Check first: an existing `docs/` layout, `CONTEXT-MAP.md` (multi-context monorepo — propose per-context placement, and point here rather than enumerating every context inline), or a `## Agent skills` block in `CLAUDE.md`/`AGENTS.md`. Propose what you find, or default to a single `docs/` directory at the repo root if there's no signal either way. Confirm with the user.
2. **Issue Tracker** — where do actionable tickets get filed? Check `git remote -v` (GitHub → `gh` CLI, GitLab → `glab` CLI) and whether `.scratch/` is already in use (local-markdown convention). Propose accordingly; ask directly only if genuinely ambiguous.
3. **Issue Definition** — what makes a valid issue for this project? Default: title + acceptance criteria + a `Status: ready-for-agent` marker. If the repo already has `.github/ISSUE_TEMPLATE/` or an equivalent, defer to that instead and just record where it lives — don't inline the template's fields here.

Persist the answers through the script — never hand-edit the manifest, so the shape the checker parses stays guaranteed-consistent:

```bash
node "<this-skill-dir>/scripts/check-project-docs.js" init --doc-location "<answer>" --tracker "<answer>" --issue-definition "<answer>"
```

This is a one-time cost per repo. Once `projectDocs` exists in this repo's manifest, every future `/to-spec` (and `/to-tickets`, once installed) run skips straight past this step — that's the whole point of making it a script gate instead of a prose reminder. Run the script with `--help` for the full command/flag reference.

Note this manifest lives under a gitignored path (`.claude/harness-everything/`, etc.) — it's local runtime state, not a committed team doc. On a fresh clone (or a teammate's machine), Step 0 will come back Exit 1 once and re-run the short interview; that's expected, not a bug.

### 1. Gather context

Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout, and respect any ADRs in the area you're touching.

If `grill-with-docs` or `grill-me` ran earlier in this conversation, treat their resolved decisions (updated `CONTEXT.md` entries, new ADRs) as settled input — cite them, don't reopen them. For anything they didn't cover, synthesize from what's already been said rather than asking new questions. If a genuinely new, unresolved fork turns up that blocks writing the doc, that's a sign this conversation needed a grilling pass first — say so and suggest running `grill-me`/`grill-with-docs` before continuing, rather than interviewing ad hoc inside this skill.

### 2. Pick the template shape

Look at what's actually being built and choose the closest fit — don't default to the heaviest one out of habit:

| Shape | File | Fits when... |
| :--- | :--- | :--- |
| Feature spec (PRD) | [templates/feature-spec.md](templates/feature-spec.md) | New user-facing feature/product surface with several implementation decisions — the thing that gets broken into tickets afterward (Tier 3, usually). |
| CLI / API reference | [templates/cli-reference.md](templates/cli-reference.md) | A new or changed command, flag set, or single endpoint (Tier 2 or 3). |
| Schema / file format | [templates/schema-doc.md](templates/schema-doc.md) | A data shape change — DB schema, config format, wire payload, on-disk state (Tier 2 or 3). |
| Dev / design doc | [templates/dev-doc.md](templates/dev-doc.md) | A scoped technical decision worth recording that doesn't clear `grill-with-docs`'s bar for a full ADR (Tier 2, usually). |

Real work often spans more than one shape (a feature that adds an endpoint *and* a new schema field). In that case, lead with the shape that's the primary artifact and fold the others in as extra sections rather than publishing several disconnected docs. Treat every template as a skeleton to adapt — add sections the project's own docs conventionally include, drop ones that don't apply, rename headings to match the project's existing vocabulary.

### 3. Confirm the interface before publishing

What "confirm" means depends on the shape picked in Step 2:

- **Feature spec** → sketch the seams at which you'll test the feature. Prefer existing seams to new ones; use the highest seam possible; the ideal number is one. Check with the user that the seams match their expectations.
- **CLI/API reference or schema doc** → confirm the surface itself (the flag names, the field names/types) with the user before writing the full doc — that's the part expensive to change after the fact.
- **Dev doc** → confirm the decision statement in one line before expanding it into the full doc.

Skip this step only if the conversation already pinned down the relevant surface explicitly (e.g. a prior `grill-with-docs` pass already fixed the schema).

### 4. Write and publish

Write the doc using the adapted template. Where it lands depends on the shape *and* the repo's `projectDocs` entry:

- **Feature spec** → files as an issue, per the entry's `tracker` and `issueDefinition` fields (e.g. `.scratch/<feature-slug>/spec.md` for a local tracker, or a real issue via `gh`/`glab`/other). Apply whatever status marker `issueDefinition` specifies (default `Status: ready-for-agent`); apply a tracker label of the same name only if it already exists — skip rather than fail if it doesn't.
- **CLI/API reference, schema doc, dev doc** → normally a standalone reference doc under the `docLocation` field, not filed as an issue (e.g. `docs/reference/<slug>.md`, or wherever that field points). If it's genuinely unclear whether this particular doc should *also* become an actionable issue, ask — don't guess either way.

No additional triage needed beyond the `issueDefinition` marker. A clearly-shaped doc in the right place — whichever template it came from — is what lets `to-tickets` cut clean vertical slices afterward instead of guessing at scope from a raw conversation transcript.
