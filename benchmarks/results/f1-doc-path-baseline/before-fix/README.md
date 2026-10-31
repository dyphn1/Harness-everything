# F1 doc-path baseline

Record of `harness-everything/scripts/doc-check.js check` run from a cwd outside the worktree, using absolute script paths. Base `--base b7136e4` (main at the start of F1). Raw stdout and stderr sit next to this file, named by case.

**Result: the packet's clean-doc expectation (exit 0) is not met.** The clean dogfood doc exits 1. Lint flags example IDs that appear in its prose and inline code (see the blocker below). The injected defects are detected correctly.

## Commands

Each row is `node <script> check --workspace <worktree> --config <config> --changed-path docs/document-lifecycle.md --base b7136e4`, with `<script>` set as shown. Wall time is the process wall clock on macOS, Node v24.14.1, and includes Node startup.

| Case | Script | Config | Exit | Expected | Wall ms | Trimmed output |
|---|---|---|---|---|---|---|
| 1-source-clean | `harness-everything/scripts/doc-check.js` | `.agents/harness-everything/project-docs.json` | **1** | 0 | 111 | lint exit 1: 14 errors (`missing-req` ×6, `unresolved-ref` ×8); links checked 6, broken 0 |
| 2-source-injected | same | same | 1 | 1 | 108 | lint: `invalid-status` (`status: bogus`) + the same reference errors; links: `./does-not-exist.md` broken at line 328 |
| 3-source-reverted | same | same | **1** | 0 | 108 | Byte-identical to the pre-injection copy (`cmp` passed); same output as case 1 |
| 4a-packaged-clean | `plugins/harness-everything/skills/harness-everything/scripts/doc-check.js` | same | 1 | = source | 112 | stdout byte-identical to 1-source-clean |
| 4b-packaged-injected | packaged | same | 1 | = source | 109 | stdout byte-identical to 2-source-injected |
| 5-source-missing-config | `harness-everything/scripts/doc-check.js` | `.agents/harness-everything/does-not-exist.json` | 2 | 2 | 60 | lint exit 2, `cannot read config: ENOENT`; links `skipped: lint-usage-error` |
| 5b-packaged-missing-config | packaged | same | 2 | 2 | 59 | stdout byte-identical to 5-source-missing-config |
| 6-supplementary-fixture-ok (not the dogfood doc) | source and packaged | copy of the config | 0 / 0 | 0 | not timed | Fixture in a temp dir with no ID tokens and two valid relative links; lint 0 diagnostics; links checked 2, broken 0; `immutability: unavailable` (not a git repo) |

Packaged and source stdout matched byte-for-byte for cases 1, 2 and 5.

## Blocker: lint flags example IDs in the dogfood doc

- **executed:** `doc-lifecycle.js lint` on the dogfood doc reports `missing-req` and `unresolved-ref` for example IDs such as `REQ-GRAPH-012`, `GRPH-007` and `PRD-GRPH-001@r2`.
- **executed:** Minimal reproducer. A doc with frontmatter and no ID-shaped tokens gives 0 diagnostics. The same doc with only `` `GRPH-007` `` in a code span gives `unresolved-ref: reference GRPH-007 cannot be resolved`. Lint's reference scanner does not skip inline code spans.
- **source-traced:** `doc-lifecycle.js` scans prose for ID patterns with `referencePattern` (around line 1282), excluding only fenced blocks. The doc uses those IDs as examples of the ID grammar in prose (lines 140–256).
- **Consequence:** getting exit 0 on this doc needs either a content rewrite of the example IDs (outside "no content rewrite") or a `doc-lifecycle.js` change (outside F1's write-set and marked "reuse unchanged" in A0). Neither was done here. Needs an amended packet.

## Notes

- The frontmatter added to `docs/document-lifecycle.md` (`role: reference`, `status: active`) is the only content change to that file. The baseline's injections were applied to a copy and then restored byte-identical.
- The supplementary fixture is evidence for the exit-0 path only. It is not a dogfood result.
