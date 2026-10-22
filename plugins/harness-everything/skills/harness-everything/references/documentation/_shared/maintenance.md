# Shared Maintenance (D6.5, D6.6)

Shared by the doc-producing skills and the editorial doc check. Read this when a change touches a governed document, a requirement, a ticket or an ADR. The command for the mechanical checks is in [doc-check.md](../../doc-check.md).

## Event table

Origin cites the source table in `docs/document-lifecycle.md` (a repo file; it is not in the packaged skill). Strength and Enforced by are copied from that source. `—` means the source gives no strength or enforcement for the row. It does not mean the row is optional.

| Origin | Event | Obligation | Strength | Enforced by |
|---|---|---|---|---|
| D6.5 (line 267), D6.9 (line 188) | Edit an existing document | Update it rather than create a new one (update-over-create). **Exception:** an effective PRD is never edited in place; a change creates a new complete revision copied from the current effective revision (section "Contract-style PRD revisions (D6.9)") | — | — |
| D6.5 (line 265) | Any governed file touched | Lint (role, status, ID, alias) and in-repo link check (`doc-check.md`) | — | — |
| D6.5 (line 267) | New PRD or ADR outline | Outline confirmation | MUST | — |
| D6.5 (line 267) | New other governed outline | Outline confirmation | SHOULD | — |
| D6.5 (line 268) | Declared derived source affected | Regenerate and regenerate-equals; the command-lane procedure is in `doc-check.md` § Derived views | — | — |
| D6.5 (line 269) | Normative field: frontmatter `status` or `supersedes`, PRD REQ block or acceptance, ADR *Decision* section | Quality review; D6.4 conflict check | MUST | — |
| D6.5 (line 270) | Governed reference or guide content | Prose > 50% reminder (see `writing-craft.md`) | SHOULD | — |
| D6.6 (lines 285, 303) | Test citing `REQ-X` added or its assertions changed | Update or supersede `REQ-X` in the same change, or record `no-req-change` with reason and cited evidence | MUST | New rule |
| D6.6 (line 295) | `no-req-change` without adequate evidence | Recorded as `not-observed`; never an automatic pass | — | — |
| D6.6 (line 298) | Code changed, no REQ-citing test touched | `not-observed`, not a failure; a diff alone does not prove behaviour unchanged | — | — |
| D6.6 (line 299) | Agent claims `REQ-X` affected, no supporting evidence | Claim and evidence contradict; reminder, no lock | — | — |
| D6.6 (line 304) | `describes:` fingerprint drift | Reminder | SHOULD | D5 #4 |
| D6.6 (line 305) | Ticket closed | In-repo tickets: `status: done`; regenerate index. `tickets: "tracker"`: no in-repo ticket status is generated or inferred offline | MUST | D5 #1 + D6.3 lint |
| D6.6 (line 306) | ADR superseded | Old ADR `status: superseded` | MUST | D6.3 lint |
| D6.6 (line 307) | New defect | Goes to tracker or the declared `tickets` path | MUST | Lint reminder when a ticket is added under a `done` phase |
| D6.6 (line 308) | Report finished | `final`; `archived` once its work closes | SHOULD | Reminder |

## Not automated

- Derived-view generator execution. It stays host-authorized: discovery of affected views and the `compare-derived` comparison execute nothing. See `doc-check.md` § Derived views.
- Trusted reconciliation credit. The lint and link check is ordinary command evidence only.
- Code-to-doc dependency edges (#350).
- Forcing or selecting a provider. Advisory provider suggestions do exist (`doc-providers.js`, `suggestDocProviders`, S3); they are never forced or auto-selected.
- Auto-publish, auto-commit, or automatic locks.
- Changes to the S1 default-OFF pilot.

Each skill's own approval and authority contract still applies. This table adds obligations; it does not replace them.
