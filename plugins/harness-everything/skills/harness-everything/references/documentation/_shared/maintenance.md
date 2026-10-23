# Shared Maintenance (D6.5, D6.6)

Shared by the doc-producing skills and the editorial doc check. Read this when a change touches a governed document, a requirement, a ticket or an ADR. The command for the mechanical checks is in [doc-check.md](../../doc-check.md).

## Event table

Origins cite D-numbers and section names in `docs/document-lifecycle.md` (the repository source; it is not in the packaged skill). Strength and Enforced by are copied from that source. `—` means the source gives no strength or enforcement for the row. It does not mean the row is optional.

| Origin | Event | Obligation | Strength | Enforced by |
|---|---|---|---|---|
| D6.5 — `doc-change` applicability by diff facts | Any governed file touched | Lint (role, status, ID, alias) and in-repo link check (`doc-check.md`) | — | — |
| D6.5 — `doc-change` applicability by diff facts | New governed file | Update-over-create check | — | — |
| D6.5 — `doc-change` applicability by diff facts | New PRD or ADR outline | Outline confirmation | MUST | — |
| D6.5 — `doc-change` applicability by diff facts | New other governed outline | Outline confirmation | SHOULD | — |
| D6.5 — `doc-change` applicability by diff facts | Declared derived source affected | Regenerate and regenerate-equals (generators are not automated; see below); the command-lane procedure is in `doc-check.md` § Derived views | — | — |
| D6.5 — `doc-change` applicability by diff facts | Normative field: frontmatter `status` or `supersedes`, PRD REQ block or acceptance, ADR *Decision* section | Quality review; D6.4 conflict check | MUST | — |
| D6.5 — `doc-change` applicability by diff facts | Governed reference or guide content | Prose > 50% reminder (see `writing-craft.md`) | SHOULD | — |
| D6.6 — Event-driven maintenance | A test citing `REQ-X` is added or its assertions change | Update or supersede `REQ-X` in the same change, or record `no-req-change` with reason and cited evidence | MUST | New rule |
| D6.6 — Event-driven maintenance | An existing test's cited REQ identity set is added, removed, or retargeted, or the changed call cannot be associated with its prior identity | Applicability/scope `unknown`, never N/A; retain candidate REQ identities and the test path. If removal leaves no candidate identity, retain the prior REQ ID as a removed identity. A citation-only change is not by itself a `new-test` or `assertion-change` trigger | — | — |
| D6.6 — Event-driven maintenance | A legacy file-level REQ tag is added, removed, or retargeted on a modified test file | Applicability/scope `unknown`, never N/A; retain the changed identity and test path, even when stripped comments leave assertion tokens unchanged | — | — |
| D6.6 — Event-driven maintenance | `no-req-change` without adequate evidence | Recorded as `not-observed`; never an automatic pass | — | — |
| D6.6 — Event-driven maintenance | Code changed, no REQ-citing test touched | `not-observed`, not a failure; a diff alone does not prove behaviour unchanged | — | — |
| D6.6 — Event-driven maintenance | Agent claims `REQ-X` affected, no supporting evidence | Claim and evidence contradict; reminder, no lock | — | — |
| D6.6 — Event-driven maintenance | `describes:` fingerprint drift | Reminder | SHOULD | D5 #4 |
| D6.6 — Event-driven maintenance | Ticket closed | In-repo tickets: `status: done`; regenerate index. `tickets: "tracker"`: no in-repo ticket status is generated or inferred offline | MUST | D5 #1 + D6.3 lint |
| D6.6 — Event-driven maintenance | ADR superseded | Old ADR `status: superseded` | MUST | D6.3 lint |
| D6.6 — Event-driven maintenance | New defect | Goes to tracker or the declared `tickets` path | MUST | Lint reminder when a ticket is added under a `done` phase |
| D6.6 — Event-driven maintenance | Report finished | `final`; `archived` once its work closes | SHOULD | Reminder |

For PRDs (D6.9, “Contract-style PRD revisions”), the update-over-create check applies when adding a governed file. An existing draft revision can be edited in place and is never authoritative. An approved revision may only be activated (`status` and `effective_at`, at the same path); any other edit requires returning it to `draft` and re-approving. An effective revision is frozen; a change creates a new complete revision copied from the current effective revision.

## Not automated

- Derived-view generator execution. It stays host-authorized: discovery of affected views and the `compare-derived` comparison execute nothing. See `doc-check.md` § Derived views.
- Trusted reconciliation credit. The lint and link check is ordinary command evidence only.
- Code-to-doc dependency edges (#350).
- Forcing or selecting a provider. Advisory provider suggestions do exist (`doc-providers.js`, `suggestDocProviders`, S3); they are never forced or auto-selected.
- Auto-publish, auto-commit, or automatic locks.
- Changes to the S1 default-OFF pilot.

Each skill's own approval and authority contract still applies. This table adds obligations; it does not replace them.
