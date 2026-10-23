# F3-P-f2 report

Workspace: `<paired>/arm-f2` (all work confined to it; no git/gh used).

## 1. Files read (in order)

1. `<scratch>` — routed per its instructions.
2. `<scratch>` — the governed document to deprecate.
3. `<scratch>` — D6.1 status vocabulary: role `reference` permits `active` / `deprecated`; D6.5/D6.6 diff-fact and event obligations; generated-index contract.
4. `<scratch>` — governed paths + the declared derived-index generator.
5. `<scratch>` — derived view depending on the document (read to confirm staleness after the edit).
6. `<scratch>` (lines 14–19) — to diagnose the 55 failing mechanism suites.

## 2. Files changed

- `docs/architecture.md` — frontmatter `status: active` → `status: deprecated`. Owner deprecation decision; sole content change (no body edit).
- `docs/governed-index.md` — regenerated with the project-declared generator because its shown status for `docs/architecture.md` now depended on the edited frontmatter.

## 3. Commands run

| Command | Exit | Trimmed stdout |
|---|---|---|
| `node harness-everything/scripts/doc-lifecycle.js index --workspace . --config .agents/harness-everything/project-docs.json --all` (dry run) | 0 | index showing `docs/architecture.md` with `status: deprecated` |
| same command redirected to `docs/governed-index.md` (regenerate) | 0 | regenerated index |
| `node harness-everything/scripts/doc-lifecycle.js lint --workspace . --config .agents/harness-everything/project-docs.json --changed-path docs/architecture.md --changed-path docs/governed-index.md` | 0 | `{"diagnostics": [], "evidence": {"immutability": "not-observed"}}` |
| regenerate-again piped, diffed against committed `docs/governed-index.md` | 0 | `regenerate-equals: identical` |
| `node harness-everything/scripts/verify-gate.js --json` | 0 (report status FAILED) | `check package-test exited 1` — `npm run test` runs 55 pre-existing environmental failures, see below |
| `npm run test --silent` | 1 | 55 mechanism suites fail with `TypeError ... path.join(...) Received null at ci/test-helper.js:17` (plus `ENOENT ... node_modules`, `1 invalid case file(s)`) |
| `node ci/mechanism-2ax-doc-lifecycle.test.js` (with change applied) | fails | same `ERR_INVALID_ARG_TYPE` at `ci/test-helper.js:17` |
| `node ci/mechanism-2ax-doc-lifecycle.test.js` (baseline: revert applied, identical output) | fails | byte-identical `ERR_INVALID_ARG_TYPE` failure |
| revert re-applied; lint + regenerate-equals re-run | 0 | as above |

Baseline evidence: the representative failing suite fails identically with and without my edit, so the 55 `npm test` failures are pre-existing environmental (scratchpad has no `node_modules`; `getWorkspaceRoot()` returns null at `ci/test-helper.js:17`), not caused by the change.

## 4. Guidance followed

- `harness-everything/SKILL.md` (Workflow step 1+): routed task, then used the project's document-lifecycle guidance rather than improvising. Its `verify-gate.js --json` invariant (MUST) was run; it fails on pre-existing environmental `npm test` failures, shown not caused by this change via the revert baseline above.
- `docs/document-lifecycle.md` (D6.1 status table): role `reference` vocabulary is `active` / `deprecated` → used exactly `status: deprecated`.
- `docs/document-lifecycle.md` (D6.5 diff facts): "Any governed file touched" → lint + in-repo link check; "Normative field: frontmatter status" → this is the status-field fact; "Declared derived source affected" → regenerate + regenerate-equals — all satisfied.
- `.agents/harness-everything/project-docs.json` (D5 derived generator): ran the declared generator command verbatim to regenerate `docs/governed-index.md`, then verified byte-identical regeneration.
- No other content edits: remaining `docs/architecture.md` mentions in `docs/audit.md` are historical narrative, not governance dependencies; no `supersedes` edge involved.

STATUS: DONE
