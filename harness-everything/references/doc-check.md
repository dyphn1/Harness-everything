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

Stdout is one JSON object:

```text
{ lint: {exit, evidence, diagnostics}, links: {checked, broken: [{path, line, target}]}, coverage: {unsupported: [...]} }
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

## What it does not prove

- No normative review, quality review or conflict review. Normative changes still need their own review.
- No trusted reconciliation credit. Exit 0 is ordinary command evidence, not a documentation-obligation PASS.
- Link checks cover only inline `[text](target)` links to local files. Anything else appears in `coverage.unsupported`:

| Syntax | Result |
|---|---|
| `http:`, `https:`, `mailto:`, `#fragment` | Skipped on purpose |
| `<angle>` destinations and `?query` suffixes | Checked as their plain target |
| Other schemes, root-relative `/path`, scheme-less `www.` targets, reference-style links | Listed as unsupported, not checked |
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

## Record evidence

Keep these in the task's verification record:

- The full command, the workspace, the `--base` SHA and the changed paths
- Exit code and stdout (stderr if exit 2)
- Whether `coverage.unsupported` is empty
- Label the claim as command evidence, not as document-obligation credit
