# F1 doc-path baseline

Record of `harness-everything/scripts/doc-check.js check` on the two dogfood docs, run from a cwd outside the repo with absolute script paths. Base `--base b7136e4`. Dogfood set: `docs/architecture.md` and `docs/doc-workflow-reconciliation.md`, governed as `reference` in `.agents/harness-everything/project-docs.json`. Re-run on the final F1-W3 tree.

Wall time is the process wall clock on macOS, Node v24.14.1, including Node startup.

## Final tree (F1-W3)

Each row runs `node <script> check --workspace <worktree> --config .agents/harness-everything/project-docs.json --changed-path docs/architecture.md --changed-path docs/doc-workflow-reconciliation.md --base b7136e4`.

| Case | Script | Exit | Expected | Wall ms | Trimmed output |
|---|---|---|---|---|---|
| 1-source-clean | `harness-everything/scripts/doc-check.js` | **0** | 0 | 227 | lint exit 0, 0 diagnostics; links checked 12, broken 0; `coverage.unsupported`: `no domains declared; bare <DOMAIN>-NNN references are not checked` |
| 2-source-injected | same | 1 | 1 | 174 | lint `invalid-status` (`status: bogus`); links broken `./does-not-exist.md` at `docs/architecture.md:229`; links checked 13 |
| 3-source-reverted | same | **0** | 0 | 129 | byte-identical to the pre-injection copy (`cmp`); same output as case 1 |
| 4a-packaged-clean | `plugins/harness-everything/skills/harness-everything/scripts/doc-check.js` | 0 | = source | 190 | stdout byte-identical to 1-source-clean |
| 4b-packaged-injected | packaged | 1 | = source | 128 | stdout byte-identical to 2-source-injected |
| 5-source-missing-config (`--config .agents/harness-everything/does-not-exist.json`) | `harness-everything/scripts/doc-check.js` | 2 | 2 | 63 | lint exit 2, `cannot read config: ENOENT`; links `skipped: lint-usage-error` |
| 5b-packaged-missing-config | packaged | 2 | = source | 66 | stdout byte-identical to 5-source-missing-config |

Raw stdout and stderr for each case sit beside this file. The injected copy is `2-injected-architecture.md`.

- **executed:** The clean run exits 0 with partial coverage. The `no domains declared` note is the intended signal: this config cannot check bare ADR-style references.

## Shared derivation effect

- **executed (F1-R finding 3):** Removing the false `SHA-256` error flips `citedReqs[].resolution` from `analysis-error` to `resolved`, and the `requirement-sync` obligation scope gains `docs/prd/graph.md`. This is intended: the false error was the defect. The scan rule is shared by S1, S2a and 3a derivation, so the change reaches those paths too. The S1, S2a, 3a and 2ax suites stay green.

## Before fix (F1-W, preserved)

Earlier run with the dogfood doc `docs/document-lifecycle.md` governed. Kept in [before-fix/](before-fix/README.md) with its raw outputs. It exited 1 on the clean doc because bare tokens such as `SHA-256` and example IDs were treated as references. The fix changes that behaviour.

## Fix evidence: 31-doc probe (final tree)

Each `docs/*.md` governed alone as `reference`, run through lint with the `origin/main` script (before) and the fixed script (after). Both runs use the final tree's docs. Probe script and raw JSON are in [probe-31-docs/](probe-31-docs/).

| Measure | Before (origin/main) | After (final tree) |
|---|---|---|
| Docs probed | 31 | 31 |
| Docs with `unresolved-ref` or `missing-req` | 6 | 1 |
| Total diagnostics | 49 | 42 |
| `unresolved-ref` | 14 | 7 |
| `missing-req` | 6 | 6 |
| `missing-status` | 29 | 29 |

- **executed:** The 5 docs flagged only by a bare token (`architecture.md`, `codex-action-gate.md`, `system-one-corpus.md`, `system-one-routing.md`, `system-one-training.md`) now have no reference diagnostic.
- **executed:** The remaining reference diagnostic is in `document-lifecycle.md` (13 after, 15 before): 6 `missing-req` and 7 `unresolved-ref` for `REQ-`, `PRD-` and `legacy:` references, which the fix leaves unchanged. The `PRD-012` and `REQ-012` malformed refs match `origin/main`.
- `missing-status` 29 is a probe artifact: an ungoverned doc has no `status:` frontmatter, so it fails the reference role's status requirement. It is the same before and after.

### F1-W2 intermediate numbers (superseded)

The earlier F1-W2 run reported before 49 / after 43 with `unresolved-ref` 13 → 7, measured on an intermediate tree. Those figures are superseded by the table above and kept here only for traceability.

Local absolute paths in the missing-config outputs are redacted to `<workspace>`.
