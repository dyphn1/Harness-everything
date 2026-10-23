# F3-P-f3 report (arm f3)

## 1. Files read (absolute paths, in order)

1. `<paired>/arm-f3/harness-everything/SKILL.md`
2. `<paired>/arm-f3/harness-everything/references/triage-and-tiers.md`
3. `<paired>/arm-f3/harness-everything/references/doc-check.md`
4. `<paired>/arm-f3/.agents/harness-everything/project-docs.json`
5. `<paired>/arm-f3/docs/architecture.md`
6. `<paired>/arm-f3/docs/governed-index.md`
7. `<paired>/arm-f3/AGENTS.md`
8. `<paired>/arm-f3/harness-everything/scripts/doc-lifecycle.js` (status vocabulary, via grep/sed)

## 2. Files changed

| File | Reason |
|---|---|
| `docs/architecture.md` | Frontmatter `status: active` → `status: deprecated` (owner deprecation decision; only status vocabulary value for role `reference` that records deprecation). No other content changed. |
| `docs/governed-index.md` | Derived view regenerated per its declared generator; it previously showed `docs/architecture.md` as `status: active`. |

## 3. Commands run

Workspace root for all commands:
`<paired>/arm-f3`

**3.1 Doc check (before derived-view regeneration)** — `node harness-everything/scripts/doc-check.js check --workspace "$PWD" --config .agents/harness-everything/project-docs.json --changed-path "docs/architecture.md"`
- exit 0; lint exit 0, diagnostics []; links checked 2, broken []; coverage.unsupported: domains notice + governed-index.md listed as unverified derived view.
- `--base` omitted (git commands forbidden in this workspace), so `evidence.immutability: not-observed`.

**3.2 Authorized generator (stdout captured to scratch)** — `node harness-everything/scripts/doc-lifecycle.js index --workspace . --config .agents/harness-everything/project-docs.json --all > <tmpdir>/opencode/governed-index-candidate.md 2> <tmpdir>/opencode/governed-index-gen.stderr`
- exit 0; stdout artifact 303 bytes; stderr 0 bytes (empty).
- This is the exact generator string declared in `.agents/harness-everything/project-docs.json` for this view; packet authorized running project-declared commands.

**3.3 First compare-derived (target not yet regenerated)** — `node harness-everything/scripts/doc-check.js compare-derived --workspace "$PWD" --config .agents/harness-everything/project-docs.json --view docs/governed-index.md --candidate scratch-candidate --generation-status ok`
- exit 1; result `stale`, "candidate bytes differ from the declared target; target left unchanged".

**3.4 Write declared target** — `cp <scratch candidate> docs/governed-index.md` (exit 0). New target content shows:
- `(no id)` — `docs/architecture.md` (role: reference; status: **deprecated**)
- `(no id)` — `docs/doc-workflow-reconciliation.md` (role: reference; status: active)

**3.5 Second compare-derived (after write)** — same as 3.3
- exit 0; result `equal`, "candidate bytes equal the declared target".

**3.6 Final doc check (both changed paths)** — `node harness-everything/scripts/doc-check.js check --workspace "$PWD" --config .agents/harness-everything/project-docs.json --changed-path "docs/architecture.md" --changed-path "docs/governed-index.md"`
- exit 0; lint exit 0, diagnostics []; links checked 2, broken []; no reminders.
- coverage.unsupported: the two expected partial-coverage items — the "no domains declared" notice, and governed-index.md reported both as `not governed` (it is a derived target, not a governed source) and `unverified` (check never runs generators under this contract). The equality claim for the derived view is carried by command 3.5's `equal` at exit 0, per doc-check.md ("Record one comparison per affected view in the task report").

## 4. Guidance followed

- **`harness-everything/SKILL.md`** — routed the task through Harness; triaged as Tier 1 (single small governed-doc edit) with `direct-single` smallest topology; kept semantic obligations: verify before claim, single Harness Status block, re-plan rule not triggered.
- **`harness-everything/references/triage-and-tiers.md`** — the SKILL.md deep dive pointer led here; its "Governed-doc check" section sent edits of files governed by `.agents/harness-everything/project-docs.json` to the doc-check lane in `references/doc-check.md`.
- **`harness-everything/references/doc-check.md`** — ran lifecycle lint + link check after the edit; followed the "Derived views" contract: applicability `conservative-all-governed` (the governed source edit affects the declared derived view), authorized generation with stdout-only capture to a scratch file outside source globs, then `compare-derived` byte-equality verification. Called this command evidence, not document-obligation credit.
- **`.agents/harness-everything/project-docs.json`** (`project-docs-resolver` project config) — declared `docs/architecture.md` governed with role `reference`, and the derived view `docs/governed-index.md` with its exact generator command; used as written.
- **`harness-everything/scripts/doc-lifecycle.js`** — supplied the project's status vocabulary: role `reference` allows `active` / `deprecated`; `deprecated` chosen.
- **`AGENTS.md` (workspace)** — emitted the Harness Status block; avoided git/gh commands as packet-required; verification per the doc lane (npm `verify:all` not run: this workspace change is docs-only and the packet scope is the controlled copy, not the parent repo).

STATUS: DONE
