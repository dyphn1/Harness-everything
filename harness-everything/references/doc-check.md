# Doc Check (editorial lane)

One command for an edited governed document: lifecycle lint plus local Markdown link targets. Use it to find and fix defects, then record the real output.

## When to run

| Trigger | Run |
|---|---|
| Active `doc-change` step (instruction-led: no step binding exists; `SKILL.md` deep dive → `triage-and-tiers.md` leads here) | Yes, after each edit and before claiming the doc is done |
| Any edit to a file governed by `.agents/harness-everything/project-docs.json` | Yes |
| Ungoverned file | No. It appears in `coverage.unsupported`; this is not a doc check |

## Command

Replace `<this-skill-dir>` with the directory of the loaded skill. Use an absolute workspace path.

```text
node "<this-skill-dir>/scripts/doc-check.js" check \
  --workspace "<absolute-project-root>" \
  --config .agents/harness-everything/project-docs.json \
  --changed-path "docs/document-lifecycle.md" \
  --base <recorded-base-commit>
```

- `--changed-path` is repeatable. Quote paths with spaces. Pass deleted and old rename paths too.
- `--base` is the commit the change is measured against. Omit it and the output shows `evidence.immutability: not-observed`.

| Layout | `<this-skill-dir>` |
|---|---|
| Source checkout | `<checkout>/harness-everything` |
| Packaged plugin | `<plugin-root>/skills/harness-everything` |

Run it from any cwd. The script finds its sibling `doc-lifecycle.js` from its own location.

## Output and exit codes

Stdout is always one JSON object. Successful checks use this shape:

```text
{ lint: {exit, evidence, diagnostics}, links: {checked, broken: [{path, line, target}]}, coverage: {unsupported: [...]} }
```

Usage or config errors use this reduced shape:

```text
{ lint: {exit: 2, error}, links: {checked: 0, broken: [], skipped: "lint-usage-error"}, coverage: {unsupported: []} }
```

| Exit | Meaning |
|---|---|
| 0 | Lint passed and every checked link resolves |
| 1 | A defect: a lint error, a broken link, or an unreadable changed path (`links.broken` with `reason: "unreadable"`). Fix it and rerun |
| 2 | Usage or config error. Nothing was checked; `links.skipped` says so |

A top-level `reminders` array carries advisory prose-share items, `strength: "SHOULD"`. One item is emitted for each changed, readable, non-legacy governed `reference` doc whose body has more than 50% prose lines (`2 * proseLines > eligibleLines`). Reminders never change an exit code and are never diagnostics. The array is absent on the exit-2 lanes. A doc with malformed frontmatter gets no reminder, because lint already reports the frontmatter error.

## Shared craft and maintenance

Read these before drafting or editing a governed document:

- [writing-craft.md](documentation/_shared/writing-craft.md): writing principles and the prose-share reminder rules (D6.7)
- [maintenance.md](documentation/_shared/maintenance.md): the event table for D6.5 and D6.6

These links resolve from this `references/` directory. A copy of the skill without `references/documentation/` must report the shared reference as unavailable.

## Derived views

**Applicability** (`conservative-all-governed`, not exact dependency inference):

| Change | Affected views |
|---|---|
| Any governed or legacy source path | Every declared `derived` view |
| A declared derived output | Every declared view (the check does not narrow to the changed output) |
| The config (candidate declarations) | Every candidate declaration; removed or changed declarations are reported, never taken as proof of completion |

- Include deleted and old rename paths.
- If the baseline is unavailable, applicability stays unknown and pending.
- `check` lists each affected view in `coverage.unsupported` as unverified (`applicability: conservative-all-governed`). It never runs a generator. Partial coverage is still exit 0 when lint and links pass.
- With `--base <rev>`, `check` reads the base config through `git show` and names each declaration that is gone or changed: `applicability: declaration-removed` or `declaration-changed`, still unverified. A base revision that cannot be read is reported, not skipped.
- Without `--base`, a changed config adds a warning: removed or renamed declarations cannot be detected.
- A declared glob is reported as `applicability: glob-unsupported`, not as a concrete unverified view.
- A declared view that also matches a `governed` or `legacy` pattern is reported as `applicability: self-governed`. A derived view must not be governed or indexed by its own generator.

**Authorized generation** (host-run, per view):

1. Show the complete command, the working directory, and the expected writes.
2. Get authorization from current host policy. A non-empty `generator` string in config is not authorization.
3. Run it through the host tool. Do not wrap it to hide expansion from permission review.
4. Capture stdout bytes to a scratch file outside the source globs. stdout must hold only the artifact; logs go to stderr. Prefer `process.execPath` with an argument array over shell splitting.

**`compare-derived`** (pure; executes nothing):

```text
node "<this-skill-dir>/scripts/doc-check.js" compare-derived \
  --workspace "<project-root>" --config .agents/harness-everything/project-docs.json \
  --view docs/governed-index.md --candidate "<scratch-file>" --generation-status ok
```

| Case | Exit | Result |
|---|---|---|
| Fresh stdout, target bytes equal | 0 | `equal` |
| Target differs, or declared target missing | 1 | `stale` or `missing-view`; keep the target intact |
| Generator exit non-zero (caller-reported) | 1 | `generator-failed`; no equality claim, even on partial stdout |
| Host timeout or termination | 2 | `generation-timeout`; partial stdout is not compared |
| Executable missing or permission unavailable | 2 | `generator-unavailable`; no fallback command |
| Candidate missing or unreadable; config invalid; absent or invalid status; undeclared or ambiguous view; candidate aliases the target | 2 | `comparison-unavailable`; never PASS |
| Generator reported `unsupported` (write-in-place or glob output), or a glob or traversal or absolute `--view` | 2 | `unsupported`; the JSON result names the case |
| Missing required flag, `--flag=value` form, repeated flag, or odd argument count | 2 | `usage-error`; the JSON result names the problem |

- `--generation-status` is required: `ok`, `failed`, `timeout`, `unavailable` or `unsupported`. It is caller-reported ordinary evidence, not host attestation. For any non-`ok` value, the candidate is not read.
- `--view` must match exactly one literal declared `derived.path`. Wildcards are reported as unsupported. Traversal, absolute targets and symlink escape are rejected. A near-miss (leading `./`, a trailing `/`, a case-only difference, or backslashes) is rejected with exit 2, and the reason names the closest declared path.
- The candidate must be a regular file. A FIFO, a device or a directory gives exit 2 `comparison-unavailable`, and the call never blocks.
- The declared generator runs from the project root (cwd = the workspace). A relative path such as `node harness-everything/scripts/...` is project-relative. In an installed plugin, name the installed skill path instead.
- Byte equality only. No trimming, line-ending conversion, encoding repair, or hash-only comparison. CRLF output is stale until regenerated with the project's output convention.
- Stdout-only generators are supported. Write-in-place and glob outputs are unsupported.
- Freshness: regenerate after any source or config edit, and compare before further source edits.
- Record one comparison per affected view in the task report: the command, cwd, exit, the stdout artifact, stderr, and the `compare-derived` result.

**Windows:** use host-appropriate `npm.cmd` or PowerShell execution for authorized npm commands. Harness adds no cross-platform shell runner.

**Boundary:** generators run with the user's privileges. Neither sandboxing nor trusted provenance is provided. If the host cannot bound or terminate a run, report it unavailable instead of inventing a completed run.

## What it does not prove

- No normative review, quality review or conflict review. Normative changes still need their own review.
- No trusted reconciliation credit. Exit 0 is ordinary command evidence, not a documentation-obligation PASS.
- Link checks cover inline `[text](target)` links to local files, including nested or escaped brackets in labels and balanced parentheses in destinations. Any inline-link form the scanner cannot parse appears in `coverage.unsupported`:

| Syntax | Result |
|---|---|
| `http:`, `https:`, `mailto:`, `#fragment` | Skipped on purpose |
| `<angle>` destinations, `?query` suffixes, nested/escaped label brackets, balanced destination parentheses | Checked as their plain target |
| Other schemes, root-relative `/path`, scheme-less `www.` targets, reference-style links | Listed as unsupported, not checked |
| Malformed inline-link syntax | Listed as `inline-link-unparsed` in `coverage.unsupported` |
| Changed path not on disk (`reason: "not on disk"`) | Listed as unsupported, not checked |
| Changed path not governed (`reason: "not governed"`) | Listed as unsupported, not checked |
| Changed path on disk but unreadable | `links.broken` with `reason: "unreadable"`; exit 1 |

A non-empty `coverage.unsupported` means the check is partial. Say so when you report.

Bare `<DOMAIN>-NNN` tokens (no `REQ-`, `PRD-` or `legacy:` prefix) are references only for a declared domain or an exact known ID, alias or legacy ID. When no `domains` are declared, `coverage.unsupported` says so once per run.

## Repair a config error

| Symptom | Repair |
|---|---|
| `cannot read config` (exit 2) | Create `.agents/harness-everything/project-docs.json` with `governed` entries such as `{"path": "docs/x.md", "role": "reference"}` |
| `invalid project-docs config` (exit 2) | Fix the reported key. Roles: `prd`, `adr`, `ticket`, `reference`, `log`, `report` |
| Host `projectDocs` differs | A project file wholly overrides differing host values. Keep the fields you still need |
| `no domains declared; bare <DOMAIN>-NNN references are not checked` in `coverage.unsupported` | Declare `domains` to have bare ADR-style refs checked. An undeclared-domain token is never a valid ADR ID (contract D6.8) |

Do not silence a missing config. A missing config is a visible gap.

## Credit (F4)

The JSON carries a logical command ID (`harness.doc-check.check.v1` or `harness.doc-check.compare-derived.v1`) and per-capability `capabilities` with checked paths, coverage and skipped reasons. Credit is granted only for a registered run of this install's own script, identified by its resolved path and digest.

- This JSON is **never self-credited**. Stdout that repeats an ID or a status is not evidence of credit.
- Credit needs the host-captured raw output, checked against the producer's independently derived expected set. See `docs/doc-workflow-reconciliation.md`, section "F4: credited reconciliation".
- Reminders never earn credit.

## Record evidence

Keep these in the task's verification record:

- The full command, the workspace, the `--base` SHA and the changed paths
- Exit code and the single JSON object on stdout (`lint.error` explains exit 2)
- Whether `coverage.unsupported` is empty
- Label the claim as command evidence, not as document-obligation credit
