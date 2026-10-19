# Document Lifecycle Contract (#325)

Contract for the documentation family: project docs configuration (D5), document roles and revision metadata (D6.1–D6.3), domain-scoped IDs (D6.8) and the generated index. Owner decisions live in [#325](https://github.com/dyphn1/Harness-everything/issues/325); this file is the implementation contract that tests cite.

Documentation is a **consumer** of the #320 workflow/obligation abstractions. Nothing here is a second router, a standing maintenance loop or a cognitive lock: every check is a pure function that reports diagnostics.

## Scope of this slice (status as of 2026-10-19)

This table distinguishes merged mechanism code from end-to-end workflow integration. The last reviewed `main` commit is `3805af4ff6078bb7ef07336fa7c15abb16d4325f` (v0.36.0). That release commit carries `[skip ci]`, so no full-gate `CI` run exists for that SHA and this document does not claim its baseline is green. The historical Windows System One resident teardown (`S1-RS15`) was observed in attempt 1 of [run 39175240370](https://github.com/dyphn1/Harness-everything/actions/runs/39175240370) on `main@75e04359ae5bf11a41739f8eb04d25a76ee8f3a7`; that run completed successfully on attempt 2 and says nothing about `3805af4`. Treat the resident teardown as a known platform limitation only when a current run on the exact SHA reproduces it, and require an all-green full-gate run for that SHA before calling any baseline green.

| Phase / prerequisite | Verified implementation and remaining work |
| --- | --- |
| 0 — contract + RED fixtures | Agreed decisions and fixtures in this document, #325 and #327; preserve earlier design history |
| 1a — `project-docs.json` loader | **Merged** in #327; host-only malformed manifest protection remains a separate correction in #331 / draft PR #333 |
| 2 — roles, IDs, aliases, legacy, supersession, index, D6.9 PRD revisions | **Merged** in #327; do not rebuild this lifecycle logic for Phase 3 |
| Step-type prerequisite (#326) | **Complete:** PR #328 merged; Harness-owned `doc-change` is explicitly declared, has no implicit TDD binding, and is not auto-inserted by router/System One |
| 3a — document facts, obligations and evidence producer | **Merged** in #334: `harness-everything/scripts/doc-obligations.js` and `doc-evidence.js`. H3/H4 have *partial deterministic mechanism* coverage, not integrated workflow evidence. Known limitations: caller-attested envelope; `configDigest` presence-only; `candidateDigest` restricted to `docs/prd/`; missing independent task-scope binding; deleted/old rename paths fail closed (#335) |
| 3b — pilot-local provider suggestions and workflow evidence reconciliation | **Next implementation slice, not started.** Implement only a thin consumer adapter; do not wait for a generic #320 registry/CDG. Includes the minimum trusted producer for baseline/candidate/config/task-scope/reviewer identity, fail-closed negative cases, doc gating on both typed `step` and `obligation` writes, and freshness re-check at completion. Fix or explicitly gate #335 deletion/rename evidence before claiming complete integration; preserve existing required-binding compatibility |
| 3c — H1–H4 and paired-task evaluation | **Not started.** Mechanism tests alone are insufficient for architecture promotion; compare frozen baseline and treatment on real bounded tasks, success/failure first, then conditional cost and latency |
| 1b — shared documentation craft and family metadata | **Splittable.** Shared references and thin skill consumers can proceed independently. A small optional logical-family metadata seam may be piloted; physical skill directory moves remain blocked on #320 identity/path separation |
| 4 — derived-view generators and `describes:` drift | **Not started.** Preserve generator authorization, deterministic regenerate-equals and scoped reminder semantics |

### Phase 3b — narrow integration contract (planned, not shipped)

- **Inputs:** explicit active `doc-change` step, D6.5 diff facts, Phase 3a obligations/evidence, available provider *metadata*, and host capabilities.
- **Advisory provider suggestions:** `suggestDocProviders({activeStep, neededCapabilities, availableProviderMetadata, hostCapabilities})` yields candidate providers and unavailable reasons without altering the MUST/SHOULD obligation set, granting tool access, or eagerly reading unrelated `SKILL.md`. Existing binding resolution handles an explicitly chosen provider. No new automatic step selection.
- **Evidence reconciliation boundary:** the pilot wires Phase 3a results into the non-Fable typed-step path only. `hooks/scripts/workflow-disposition.js` delegates `step` to `updateStep()` and `binding` to `updateBinding()` in `hooks/scripts/lib/workflow-obligations.js`. Today `updateStep()` persists `step.status = 'pass'` when every required binding is `loaded` and `--evidence` is non-empty; `syncTypedAggregateObligations()` then derives aggregate `execute`/`verify` PASS from the persisted step statuses. Phase 3b must call `checkDocObligations()` for the active `doc-change` step's scope **before** that persistence point and refuse `pass` unless every applicable MUST has a current, satisfied result. `unresolvedObligations()` must surface the unsatisfied doc results (`pending`/`unknown`/`unavailable`/`failed`) so workflow completion cannot ignore them. Non-document steps, persisted plans, existing bindings and authorization stay unchanged.
- **Typed aggregate writes and freshness:** aggregate PASS is not derived exclusively from persisted step passes today. `updateObligation()` accepts a direct `obligation --obligation-id execute|verify --disposition pass --evidence <text>` write even when `stepBindingsEnabled === true`, and it does not restrict which ids may receive it. Phase 3b must therefore reject or ignore direct typed `execute`/`verify` writes (accepting those aggregate results only as derived/reconciled output), include the `obligation` command in the same negative tests as `step`, and make the aggregate-status invariant testable. Verified doc evidence must also stay bound to the persisted candidate, task and config identity: `unresolvedObligations()` and the final completion path must re-check freshness, so a `doc-change` step that passed before a later candidate edit cannot remain a valid completion proof solely because `status: pass` was persisted.
- **Minimum trusted producer (3b deliverable):** Phase 3b ships the pilot-local adapter that derives the VCS baseline and candidate identity, active task scope, parsed config bytes (`configDigest` bound rather than presence-checked), PRD root, execution/verification provenance and independent reviewer identity from host state (see *Phase 3b minimum trust boundary* below). `checkDocObligations()` only proves agreement with caller-supplied values; without this producer, a 3b PASS would promote caller-attested claims. Any input the producer cannot establish stays `unknown`/`unavailable` and MUST NOT pass. Phase 3c broadens adversarial H3 validation and adds paired architectural evaluation; it does not supply the minimum producer.
- **Pilot topology and unsupported paths:** the pilot is limited to non-Fable typed-step workflows (`stepBindingsEnabled === true`, set when typed steps exist and the strategy is not `fable-*`). Fable stage-contract paths (`fable-staged`, `fable-parallel`, `fable-multi-agent-workspace`) and workflows without the typed-step contract are explicitly **not integrated / unavailable** for doc-MUST reconciliation: a `stage-binding` disposition is never doc verification, and no fallback may mark a doc MUST satisfied. Unsupported paths report that state rather than silently passing.
- **Negative acceptance case:** for a `doc-change` step whose required bindings are all `loaded` and whose derived doc MUST is failing or unknown, `workflow-disposition.js step --disposition pass --evidence 'done'` must fail closed: it reports the unsatisfied obligation ids, leaves the step `pending`, and does not change aggregate `execute`/`verify` status. The same MUST blocks `obligation --obligation-id execute|verify --disposition pass --evidence 'done'` on a typed plan. A loaded skill plus free-text evidence is not verification.
- **Compatibility:** preserve existing non-document step bindings, authorization/Rule-of-3 semantics, old persisted plans and no new Stop/tool lock. Source and installed plugin copies must behave consistently.
- **Pre-integration work:** #335 must establish baseline-bound tombstone/rename-pair evidence so legitimate deletions/moves can pass and stale/missing records cannot. #331 / PR #333 is a parallel host-config safety correction; neither requires the broad #320 migration.

### Phase 3c — architecture promotion gate for #320 (planned, not shipped)

| Hypothesis | Objective acceptance evidence |
| --- | --- |
| **H1 Provider independence** | Swap/omit suggestions without changing workflow obligations; valid alternate execution evidence can satisfy an applicable MUST; no evidence cannot |
| **H2 Active-step progressive disclosure** | Captured step output / provider metadata access shows only active-step relevance and no eager unrelated `SKILL.md` content or future-step loading |
| **H3 Evidence reconciliation** | Adversarial replay of fabricated completion, missing verifier, stale digest/base, scope substitution, forged identity, unsupported PRD roots, contradictory/failed results and unsupported waiver yields **zero false PASS** for MUSTs, with the fixture matrix below as the observable trust boundary |
| **H4 Task-shaped composition** | Docs-only, docs+code, REQ-citing assertions, typo-only changes, code-only uncertainty, missing independent approval and waivers produce the expected obligation union and explicit unknown/unavailable outcomes |

### Phase 3b minimum trust boundary and Phase 3c H3 validation (planned, not shipped)

Phase 3b delivers the minimum producer and identity/scope binding needed for a trustworthy PASS; Phase 3c extends the same seam with adversarial H3 validation and paired architectural evaluation.

- **Trusted producer, not the checker:** a pilot-local adapter is a **3b deliverable**; it derives the VCS baseline and candidate identity, active task scope, project-docs config identity (parsed config bytes, not presence) and execution/review provenance from host state. `checkDocObligations()` proves only that records agree with those caller-supplied values; matching a caller-provided digest is not independent validation of the input.
- **Identity and scope requirements:** `baseline.digest` and `baseline.artifacts[path]` come from the same recorded baseline tree; candidate artifact digests come from the candidate tree actually under review; `configDigest` is bound to the parsed config bytes rather than checked for presence; the obligation's PRD root and active task scope must match the adapter's scope, and an unsupported custom PRD root is `unavailable`.
- **Provenance and reviewer identity:** execution and verification records need the command, non-empty provenance and integer exit code; review approval needs an independent reviewer identity distinct from the executor/author. A free-text claim, self-review, missing verifier or replayed record never satisfies a MUST.
- **Dispositions:** absent, untrusted, stale, replayed, contradictory, malformed or unsupported inputs resolve to `unknown`/`unavailable`/failed, never PASS. The 3b fail-closed negative cases cover missing producer identity, scope substitution, unbound config bytes and stale candidate evidence; 3c adds the full adversarial fixture matrix below.

| H3 fixture | Expected disposition |
| --- | --- |
| Fabricated completion claim / no record | `unknown`; MUST unsatisfied |
| Forged baseline or candidate digest | rejected as stale/unknown; MUST unsatisfied |
| Scope substitution across tasks or PRD roots | `unknown`; MUST unsatisfied |
| Unsupported custom PRD root | `unavailable`; MUST unsatisfied |
| Replayed earlier-candidate record | stale; MUST unsatisfied |
| Missing, non-independent or mismatched reviewer identity | MUST unsatisfied |
| Unsupported waiver (no reason, no cited observed record, or self-bound scope) | `unsupported-waiver`; MUST unsatisfied |
| Contradictory or failed command results | failed; not PASS |
| Positive control: current, independently produced matching evidence | pass |

Two *separate* gates apply. The **functional gate** requires contract tests, negative cases, source/package parity, host/platform compatibility and an all-green applicable CI baseline. The **architectural gate** additionally requires H1–H4 and independently reviewed paired real-task outcomes. Freeze task fixtures, acceptance rubrics, model/effort, host permissions, comparison order and thresholds **after baseline measurement but before treatment outcomes**. Compare task correctness and failures first; report successful-task token/time/tool cost and failed-run overhead separately, with uncertainty. A small inconclusive sample is not approval. Broader #320 CDG/registry compilation and physical skill moves need **explicit owner sign-off on each specific validated interface**; retain the legacy path until then.

## Configuration (D5)

| Source | Rule |
| --- | --- |
| `.agents/harness-everything/project-docs.json` | Committed, host-neutral. When present it **wholly overrides** host-manifest `projectDocs` (no field merge); warn `project-overrides-host` when a host value differs |
| Invalid project file | Status `invalid` with diagnostics; no fallback to host manifests; config-dependent MUSTs report unresolved |
| No project file, active host known and declares `projectDocs` | Status `host`; record that manifest as the source |
| No project file, active host known but its manifest has no `projectDocs` | **Owner decision 2026-10-17:** `none`, recording the active host; never inherit another host's config. Warn and suggest `project-docs.json` |
| No project file, host unknown | All declaring hosts canonically equal → `host` (all sources recorded); they differ → `ambiguous`; none → `none` |
| AGENTS.md | Never a configuration source |

- Canonical comparison: object keys sorted recursively, array order preserved, whitespace irrelevant.
- The project file may also carry the existing zone fields (`decisionLocation`, `domainLocation`, `architectureLocation` and their aliases). Zone resolution uses the project file when present, so the override is total.
- Host manifests that fail to parse are skipped with an `invalid-host-config` diagnostic naming the source; they never count as agreeing or disagreeing.
- **Generator security (MUST):** reading or validating config never executes `derived[].generator`. Execution belongs to an authorized verification step only.

```json
{
  "governed": [
    { "path": "docs/prd/**", "role": "prd" },
    { "path": "docs/adr/**", "role": "adr" }
  ],
  "domains": ["GRPH", "IFCE"],
  "legacy": ["docs/adr/legacy/**"],
  "derived": [{ "path": "docs/roadmap/index.md", "generator": "npm run docs:index" }],
  "tickets": "tracker"
}
```

| Field | Validation |
| --- | --- |
| `governed` | Array of `{ path: glob, role }`; `role` from the fixed vocabulary below |
| `domains` | Array of unique `^[A-Z][A-Z0-9]{1,9}$`. Reserved for ID prefixes: a legacy string value in a host manifest is read as `domainLocation` with a `deprecated-domains-string` warning; in `project-docs.json` it is a schema error |
| `legacy` | Array of globs |
| `derived` | Array of `{ path, generator }`, both non-empty strings |
| `tickets` | `"tracker"` or a repo-relative path |
| Unknown keys | Warning, not error |

Globs are repo-relative POSIX paths supporting `*` (one segment) and `**` (any depth).

## Roles and status (D6.1, D6.3)

| Role | Status vocabulary | `id` |
| --- | --- | --- |
| `prd` | `draft` / `approved` / `effective` / `rejected` / `withdrawn` (D6.9); pre-migration `active` / `superseded` warn unchanged and error when added or changed | Required: `PRD-<DOMAIN>-NNN` plus `revision` (D6.9) |
| `adr` | `proposed` / `accepted` / `rejected` / `superseded` | Required: `<DOMAIN>-NNN` |
| `ticket` | `open` / `blocked` / `done` / `withdrawn` | Optional |
| `reference` | `active` / `deprecated` | Optional |
| `log`, `report` | `final` / `archived` | Optional |

- Role comes from the first matching `governed` entry; a frontmatter `role` must agree with it.
- **Legacy immutability:** Legacy files remain outside the active ID namespace. With an observed trusted base, a path is frozen only when some base source's `legacy` matches it and no base source positively governs it after that source's own legacy exclusion; parsed frontmatter stays deep-equal while body/editorial/link edits remain allowed. A surviving path is reclassified when it is no longer legacy under the same per-source rule for candidate sources and emits `legacy-frozen-modified`; deletion/move relies on existing escalation for surviving explicit `legacy:ID@path` references. Without a trusted base, legacy immutability is not-observed or unavailable.
- Frontmatter fields: `id`, `role`, `status`, `supersedes`, `aliases`. `superseded_by` and `amends` are not stored; `superseded_by` is derived in the index.
- **Ratchet:** schema checks (role/status/ID) apply to governed files named in `changedPaths`. Full mode is explicit (`--all` / `{ all: true }`); the CLI refuses to run without `--changed`, `--changed-path` or `--all`. Cross-file integrity diagnostics are errors when any involved file is changed (deleted and renamed paths count as changed), warnings otherwise. Warnings that affect resolution still appear in the index's unresolved list. CLI `--changed` entries resolve against `--workspace`, normalize to repo-relative POSIX paths, and fail as usage errors when outside the workspace; `--changed` takes one comma-separated argument and cannot represent filenames containing commas, so repeat `--changed-path <path>` (one occurrence per path, never comma-split, normalizes and resolves like the CSV form, and mutually exclusive with `--all`; may be combined with `--changed`) when a filename contains a comma. Occurrences of either changed selector accumulate: repeated `--changed` or `--changed-path` flags add to the changed set instead of overwriting earlier declarations. The CSV form trims whitespace around its comma-separated items; `--changed-path` preserves commas and outer whitespace while resolving paths and normalizing separators. Both `/` and `\` are separators on every host; literal backslashes in POSIX filenames cannot be selected through these CLI flags — use `--all` or the API `changedPaths` for those files. Relative `--config` paths also resolve from `--workspace`. Without a trusted base, escalation for deleted or renamed targets covers explicit `legacy:ID@path` selectors only; ID-only references escalate when a trusted base (`--base` or a supplied inventory, see D6.9) maps the ID to a changed path.
- Parsing conventions: role comes from the first matching `governed` entry; frontmatter is the leading `---` block in a YAML subset (scalars, inline `[a, b]` lists, `- a` block lists); references inside fenced code blocks are ignored.

## IDs, aliases and references (D6.2, D6.8)

- ADR: `<DOMAIN>-NNN` (three or more digits). REQ: `REQ-<DOMAIN>-NNN`, defined only in a PRD as a heading `REQ-<DOMAIN>-NNN` at the start of a Markdown heading line (`### REQ-GRPH-012: …`).
- **REQ aliases — owner decision 2026-10-17:** declared on the REQ heading itself, `### REQ-GRAPH-012 (aliases: REQ-GRPH-012, REQ-GRPH-099): title`. Each alias resolves directly to that REQ; collision rules match document aliases. Document-level `aliases` never rename REQs.
- `DOMAIN` must be declared in `domains`. Aliases keep their historical domain, which need not be declared.
- `aliases: [...]` lists every previous ID; each alias resolves **directly** to the declaring document. Reject duplicate canonical IDs, an alias equal to another active canonical ID or alias, and unresolved references.

| Reference | Resolution |
| --- | --- |
| `GRPH-007` | Active canonical IDs and aliases only; never falls through to legacy |
| `legacy:GRPH-007` | The unique legacy document with that ID. Several matches → `ambiguous-legacy-ref` listing every candidate path; never the first match |
| `legacy:GRPH-007@docs/adr/legacy/v2/GRPH-007.md` | **Owner decision 2026-10-17:** the repo-relative path is the archive discriminator; resolves only when that file is legacy and carries that ID |

Selector grammar: `legacy:` + ID, optionally `@` + path, split at the **first** `@`. The path is a repo-relative POSIX path compared byte-exactly with the collected path (case-sensitive on every OS). Backslashes, leading `/`, drive letters, `.` or `..` segments, and paths outside the workspace are `invalid-ref`; they are never normalized into a match. A renamed archive path leaves old selectors `unresolved-ref` until updated.

- A legacy document's ID is its frontmatter `id`, else its file stem when that matches an ID pattern. Duplicate legacy IDs are allowed; only bare references to them are ambiguous.
- An active alias equal to a legacy ID is allowed (the rename case).
- Aliases are strings matching an ADR or REQ ID pattern. The `legacy:` prefix is reserved for references and is `invalid-alias` inside `aliases`, as are self-aliases and non-strings.

## Supersession (D6.3, D6.4)

- `supersedes` is written on the new document and means real normative replacement, never an identity rename.
- Active target: the target must carry `status: superseded`, else `supersede-status-mismatch`. This is the only required two-file edit.
- **Legacy target — owner decision 2026-10-17 (external projection):** reference it with an explicit `legacy:` ref that resolves uniquely. The legacy file is never edited; the generated index projects its status as superseded by the active document. This is the explicit legacy exception to both the D6.3 two-file lint and the D6.6 "ADR superseded → old status `superseded`" event: for legacy targets the obligation is met by the projection. The index shows the stored status and the projected effective status side by side, with the source edge.
- A plain ref that matches only a legacy ID is `unresolved-ref` with a hint to use `legacy:`.
- Self-supersession and supersession cycles are errors.
- **Branching and eligibility — owner decision 2026-10-17:** a target may have several successors; the index lists them sorted. Only edges from an `accepted` ADR or an `active` PRD are effective: they require the active target's `superseded` status and drive legacy projection. Edges from other statuses (`draft`, `proposed`, …) are shown as pending, do not require the target's status change, and do not project.
- Only explicit `supersedes` or a recorded owner decision resolves a conflict.
- **Recorded conflicts — owner decision 2026-10-17:** semantic PRD/ADR contradictions are not detected from prose. Whoever finds one records `conflicts_with: [<ID>]` on either document; the pair stays in the unresolved list (`recorded-conflict`, both IDs and paths) until an effective `supersedes` between them exists. Owner adjudication is recorded by that `supersedes` edge or by removing the entry in the same change that updates the canonical document. Structural conflicts are detected automatically.

## Diagnostics

Each diagnostic is `{ code, severity, path, id?, message, candidates? }`, sorted by `path`, `code`, `id`, then `message`.

Anchors for cross-file diagnostics: `supersede-*`, `unresolved-ref`, `ambiguous-legacy-ref`, `invalid-ref` and `recorded-conflict` attach to the document that declares the reference or edge. `legacy-frozen-modified` attaches to the trusted-base archive path. `duplicate-id`, `alias-collision` and `duplicate-req` emit one diagnostic on **every** involved document, each listing the others in `candidates`.

| Code | Trigger |
| --- | --- |
| `malformed-frontmatter` | Unparseable frontmatter block |
| `role-mismatch` | Frontmatter `role` differs from path role |
| `missing-status` / `invalid-status` | Status absent or outside the role vocabulary |
| `missing-id` / `invalid-id` / `unknown-domain` | ADR ID absent, malformed, or domain undeclared |
| `duplicate-id` | Two active documents share a canonical ID |
| `alias-collision` | Alias equals another active canonical ID or alias |
| `duplicate-req` / `missing-req` | REQ defined twice in active PRDs, or referenced in a governed doc but never defined |
| `unresolved-ref` / `ambiguous-legacy-ref` / `invalid-ref` | Reference resolves to nothing, to several legacy documents, or is malformed |
| `legacy-frozen-modified` | With a trusted base, legacy frontmatter changed or a surviving archive was reclassified out of legacy scope (error) |
| `invalid-alias` | Alias is not a string ID, is self-referential, or uses the reserved `legacy:` prefix |
| `invalid-host-config` | A host manifest's `projectDocs` failed to parse or validate |
| `supersede-status-mismatch` / `supersede-cycle` | Effective edge to an active target that is not `superseded`; self or cyclic supersession |
| `recorded-conflict` | `conflicts_with` pair without an effective `supersedes` between them |

## Contract-style PRD revisions (D6.9)

**Owner direction 2026-10-17:** an effective PRD is a contract. A change creates a new **complete** revision copied from the current effective revision; the effective snapshot is never edited in place. This replaces the D6.1 "living PRD" model for PRDs only; ADRs, tickets and other roles are unchanged. Where this section conflicts with earlier PRD rules (optional PRD `id`, PRD status vocabulary, PRD `supersedes`), this section wins.

### Identity and graph

| Concept | Rule |
| --- | --- |
| Logical PRD | `id: PRD-<DOMAIN>-NNN`, shared by every revision; grouped by canonical identity (aliases preserved) |
| Revision | `revision: <N>` positive integer, no leading zeros; canonical form `PRD-GRPH-001@r3` |
| Parent | `previous_revision: <N>`; must name an existing revision of the same logical PRD with a smaller number. Exactly one baseline (no parent) per logical PRD |
| Layout | Not mandated (recommended `docs/prd/<slug>/r003.md`); identity comes from frontmatter only |
| Uniqueness | `(logical id, revision)` unique. Repeated logical IDs and inherited aliases across revisions are not `duplicate-id` / `alias-collision` |

### Status, approval, activation

| Stored status | Editable | Notes |
| --- | --- | --- |
| `draft` | Yes | Never authoritative; drafts may fork |
| `approved` | Activation fields only | Approval bound to content |
| `effective` | **No**, from the change that sets it | Frozen artifact |
| `rejected` / `withdrawn` | Not enforced in this slice | Never selectable as current |

- **Approval record (owner decision 2026-10-17):** `approval: { by, at, ref, content_digest }`. `by` is a human or an independent cold verifier, never the drafting agent. `ref` is a URL or an in-repo record path (offline-checkable). `content_digest` covers the revision body plus non-activation frontmatter; a content edit after approval invalidates it (`approval-content-mismatch`).
- **Activation:** sets `status: effective` and `effective_at`; only these fields may change between `approved` and `effective`. The file path must also stay the same as in the trusted approved baseline. An `approved` revision is frozen except for activation; any other edit, including rebinding `approval`, requires returning it to `draft` and re-approving (`invalid-transition`). Deleting an approved revision or moving it outside the candidate inventory is also an `invalid-transition`. Timestamps are ISO 8601 with timezone; `effective_at` must not precede `approval.at`. Activation requires the parent to be the current effective revision (`stale-draft-base`).
- **Current effective** is derived after validating the whole graph: a connected chain of `effective` revisions from the baseline; two effective children of one parent → `revision-fork`; no effective revision → explicit pre-activation state. Older effective revisions are derived `historical`; their files are never edited.

### Digests and evidence envelope

- **Stored bytes:** the bytes Git stores for the file (after `git add` end-of-line normalization). Base content comes from the trusted base tree; candidate content is normalized the same way. Comparisons may use Git blob object IDs; frontmatter digests are `sha256:<hex>` over stored bytes. Pure API callers pass stored bytes directly.
- **Artifact digest** (`previous_digest`, immutability): sha256 over the complete stored bytes of the revision file.
- **Approval content digest** (`approval.content_digest`): sha256 over `JSON(frontmatter without status, effective_at, approval; keys sorted; UTF-8) + "\n" + body` (body in stored bytes). Excluding `approval` avoids self-reference; excluding activation fields lets activation keep the digest valid.
- **Independence:** `drafted_by` (required on `approved` and `effective` revisions; missing → `approval-missing`) names the drafting author; `approval.by` equal to `drafted_by` → `approval-not-independent`. `approval.role` is `human` or `cold-verifier`. The checker verifies the record's presence, binding and independence, not that a review actually happened.
- **Evidence envelope:** `analyzeDocs(docs, config, opts)` returns `{ diagnostics, evidence }` with `evidence.immutability` = `observed` | `not-observed` | `unavailable`. `lintDocs` stays the diagnostics-only projection. CLI JSON prints the envelope; exit 1 only for error diagnostics, and `not-observed` is always printed, never folded into success.
- **Offline base inventory:** `analyzeDocs(docs, config, { baseInventory: [{ id, revision, path, status, bytes }] })` supplies stored baseline bytes for offline checks. For Git-equivalent legacy freezing, supply either per-entry boolean `legacy` classifications computed under the per-source rule or `baseConfigSources`; when both are supplied, `baseConfigSources` takes precedence and applies the source rule. The supplied historical sources also govern migration checks, REQ identity lookup, and changed-scope calculations. Without either, legacy classification is not established for unflagged rows, which are not frozen, and `evidence.legacyImmutability` reports `not-observed` while byte-based `evidence.immutability` remains `observed`. Candidate classification uses `options.configSources` when supplied, otherwise `config`; equivalent trusted bytes and authority inputs must yield the same diagnostics as `--base`.
- Tests isolate Git (no global/system config, hooks, templates or signing; explicit `core.autocrlf` and attributes) and compute expected digests independently of the system under test.

### Immutability evidence

- **Byte basis (owner decision 2026-10-17):** digests use the repository-stored content (Git blob bytes, or an exported snapshot of them), so checkout line-ending conversion cannot change identity.
- `previous_digest` in each revision is an **internal consistency** check only; editing a parent and its child's digest together stays self-consistent.
- **Immutability** needs a trusted baseline: CLI `--base <git-rev>` or a supplied snapshot inventory. Base and candidate inventories are compared by `(logical id, revision)` and by path: a base-effective revision must remain present with identical bytes regardless of status edits, moves, deletions or config exclusions (`immutable-revision-modified`, `immutable-revision-deleted`). Without a trusted baseline the result is `not-observed`, never pass. The immutability scope is the **union** of governed, legacy and PRD globs from the current config and from every config source in the base tree (`project-docs.json`, each host manifest's `projectDocs`, and the base copy of an explicit `--config` path); narrowing the current config never removes a base-effective revision from checking. Stored-byte normalization follows Git's text/binary decision (including NUL detection for `text=auto` and for `core.autocrlf` without attributes); content Git stores unchanged is compared unchanged. Git is read with argument arrays, never shell interpolation; missing history is never fetched.

### REQ continuity

- Every REQ of the parent appears in the child unless accounted for by `removed_reqs: [...]` or a `replaces` edge; otherwise `req-dropped`. Each REQ block needs non-empty acceptance content (`incomplete-snapshot`). ID continuity is structural evidence only; semantic completeness still needs review.
- Unchanged and editorial REQs keep their IDs. A REQ whose text changed is reported as changed and needs a review classification (normative vs editorial); IDs are never recycled for unrelated meaning.
- Heading clauses: `### REQ-GRPH-020 (replaces: REQ-GRPH-012, REQ-GRPH-013; aliases: REQ-GRAPH-020): title`. Clauses are `;`-separated, comma lists, each at most once; unknown or duplicate clauses are errors. `replaces` allows splits and merges; a REQ ID may not be both alias and replaced target; replacement cycles are errors.
- `duplicate-req` applies within each revision and across the current effective revisions of different logical PRDs.
- Plain `REQ-…` resolves only in current effective revisions; a removed or replaced REQ is `unresolved-ref` with a historical/replacement hint, never auto-followed.

### References

| Ref | Resolves to |
| --- | --- |
| `PRD-GRPH-001` | Current effective revision |
| `PRD-GRPH-001@r2` | Exactly revision 2, returned with status, digest and provenance |
| `PRD-GRPH-001@r2#REQ-GRPH-012` | That REQ inside revision 2 (aliases resolved as of r2) |

- Parse the namespace first: `legacy:` refs keep their exact path grammar; `@r<N>` and `#REQ` apply only to PRD logical IDs. Whole-token anchored parsing; a valid prefix of an invalid ref never resolves.
- Pins to `draft`/`approved` revisions are provisional and never satisfy governed-implementation evidence; audit evidence pins an effective revision plus its digest.

### Cross-PRD replacement and migration

- **Retirement eligibility:** only an `effective` source revision retires a target or resolves a recorded conflict; edges from `draft`/`approved`/`rejected` revisions are pending (same rule as ADR effective edges).
- **Retirement is a historical event (owner decision 2026-10-17):** once any revision that was effective declares the edge, the target stays retired even if later revisions of the source omit it; omission never revives a target. The index records the revision that issued the retirement.
- **Retirement (owner decision 2026-10-17):** `supersedes: [PRD-GRPH-001@r4]` on another logical PRD retires that contract by external projection, like legacy targets: no file is edited, splits and merges are allowed, the exact source/target revisions are recorded, and the retired PRD stays addressable.
- **Baseline adoption (owner decision 2026-10-17):** an existing non-legacy living PRD gets one reviewed metadata-only edit adding `revision: 1`, approval and a `migrated_from_digest` of its prior content, recorded in a migration record. The baseline frontmatter names the record with `migration_record: <repo-relative path>`; the record is JSON `{ record: "prd-baseline-migration", id, revision, source, migrated_from_digest, approved_by }` and must match the frontmatter and the base content of `source` (`migration-record-missing` / `migration-record-mismatch`). `baseline` status never exempts later edits. Legacy PRDs stay frozen outside the graph.

### Diagnostics (D6.9)

`invalid-prd-id`, `invalid-revision`, `duplicate-revision`, `missing-parent`, `multiple-baselines`, `revision-cycle`, `revision-fork`, `stale-draft-base`, `invalid-transition`, `approval-missing`, `approval-content-mismatch`, `revision-digest-mismatch`, `immutable-revision-modified`, `immutable-revision-deleted`, `req-dropped`, `incomplete-snapshot`, `invalid-req-clause`, `replacement-alias-overlap`, `replacement-cycle`. `not-observed` is an evidence disposition, not a diagnostic and not a pass.

## D6.5 — `doc-change` applicability by diff facts (Decided; revised 2026-10-16)

Not a single class enum. The diff yields **facts**; required checks are the **union** of what each fact triggers. If a fact cannot be determined, assume it is present (`unknown` never downgrades to trivial).

| Fact (from diff) | Triggers |
| --- | --- |
| Any governed file touched | Lint (role/status/ID/alias); in-repo link check |
| Text/format only (no fact below) | Nothing more |
| New governed file | Update-over-create check; outline confirmation (MUST for PRD/ADR, SHOULD otherwise) |
| Declared derived source affected | Regenerate + regenerate-equals |
| **Normative field**: frontmatter `status`/`supersedes`, PRD REQ block/acceptance, ADR *Decision* section | Quality review (MUST); D6.4 conflict check |
| Governed reference/guide content | Prose > 50% reminder (SHOULD) |
| Code or REQ-citing test touched | `requirement-sync` evaluation (D6.6) |

Decision extraction recognizes ATX boundaries with 0–3 leading spaces and ignores fenced or indented code. A suspected Setext Decision heading, or an unsupported Setext boundary within an ATX Decision section, yields `unknown`; paragraph/container context is not inferred.

- Example: a typo in an ADR's *Context* section triggers only lint + links; the same typo in its *Decision* section is normative.
- Claimed scope vs diff facts mismatch → claim/evidence contradiction (#320 D3), only where the diff supports it; visible, never a lock.
- Commit still requires existing workflow authorization; no automatic commit.

## D6.6 — Event-driven maintenance (Decided)

**`requirement-sync` detection** (builds on D6.2: tests cite REQ IDs):

| Observation | Disposition |
| --- | --- |
| A test citing `REQ-X` is added or its assertions change | **Candidate signal**, not proof → **MUST** update/supersede REQ-X in the PRD in the same change, or record a structured `no-req-change` (reason + cited evidence, e.g. unchanged acceptance, passing test result) |
| An existing test's cited REQ identity set is added, removed, or retargeted, or the changed call cannot be associated with its prior identity | Applicability/scope `unknown`, never N/A; retain candidate REQ identities and the test path. If removal leaves no candidate identity, retain the prior REQ ID as a removed identity. A citation-only change is not by itself a `new-test` or `assertion-change` trigger |
| A legacy file-level REQ tag is added, removed, or retargeted on a modified test file | Applicability/scope `unknown`, never N/A; retain the changed identity and test path, even when stripped comments leave assertion tokens unchanged |
| A test title changes or reorders REQ IDs while preserving the same cited identity set, or an ordinary comment changes | No trigger → `requirement-sync` N/A |
| Ordinary comment-only or whitespace-only edit that preserves the cited REQ identity set | Not a trigger → `requirement-sync` N/A |
| REQ-citing test change whose assertion change cannot be determined | `unknown`; never a fail |
| Triggered MUST, **attested envelope** (all of the following), cited REQ resolved, **not** revised, **no** valid `no-req-change` waiver | **Observed fail** (`req-sync-no-revision-or-waiver`). Not a Stop hook, lock, or completion policy |
| Triggered MUST, `complete` inventory but envelope incomplete, mismatched, or unattested | `none` with `req-sync-envelope-unattested`. Never a fail |
| Attested envelope = `complete` and `waiverInventoryComplete` both `true`; `baseDigest` equal to the baseline digest; `candidateDigest` equal to the digest of the candidate PRD set; `configDigest` present; non-empty cited REQ list | Caller-attested. The derivation copies it and never infers it. Not independent proof that the caller collected the inventory completely |
| Unsupported or stale `no-req-change` waiver | Unverified (`unsupported-waiver`). It never satisfies the MUST. It does not by itself establish the failure, and an independently attested unmet obligation may still fail |
| `no-req-change` without adequate evidence | `not-observed` / unverified; never an automatic pass. An invalid waiver is diagnosed and does not satisfy the MUST |
| Cited REQ missing, ambiguous, or unresolved | `unresolved` with `req-unresolved`; never a pass, never an observed fail. "Ambiguous" means declared in two distinct current logical PRDs. Retained revisions of one PRD resolve to the current effective revision |
| Incomplete execution record (no command, no provenance, non-integer `exitCode`) | `execution-record-incomplete`; never a pass |
| Code changes, no REQ-citing test touched | `not-observed` (#320 D3 evidence state), not a failure; diff alone never proves behavior unchanged |
| Agent claims REQ-X affected, no supporting evidence | Claim/evidence contradiction; reminder, no lock |

| Event | Obligation | Strength | Enforced by |
| --- | --- | --- | --- |
| REQ touched (above) | `requirement-sync` | MUST | New rule |
| `describes:` fingerprint drift | Reminder | SHOULD | D5 #4 |
| Ticket closed | In-repo tickets: `status: done`; regenerate index. `tickets: "tracker"`: no in-repo ticket status is generated or inferred offline | MUST | D5 #1 + D6.3 lint |
| ADR superseded | Old ADR `status: superseded` | MUST | D6.3 lint |
| New defect | Goes to tracker or the declared `tickets` path | MUST | Lint reminder when a ticket is added under a `done` phase |
| Report finished | `final`; `archived` once its work closes | SHOULD | Reminder |

- All events are checked at the existing workflow's `verification` step; no standing maintenance loop.
- Checks are pure and generators deterministic, so reruns are idempotent.
- `requirement-sync` is the only genuinely new rule; the rest reuse D5 and D6.3 checks.

## Packaging

Source checkout, Codex plugin and Claude plugin copy whole skill trees. Callers locate `doc-lifecycle.js` and the resolver relative to their own skill directory, never the source-tree root. A to-spec-only install must use the same resolver implementation (copied byte-identically and checked), and a broken shared module is an error, never a silent fallback to older host scanning.

## Generated index

`buildIndex` returns Markdown with no timestamps or environment data, so two runs over the same tree are byte-identical. Sections: active documents (sorted by ID then path, with derived `superseded by`), legacy documents (sorted by ID then path, with projected status), and the unresolved list (resolution-affecting error diagnostics).

The shared `AUTHORITY_BLOCKER_DIAGNOSTICS` taxonomy covers `invalid-prd-id`, `invalid-revision`, `invalid-status`, `invalid-alias`, `duplicate-revision`, `missing-parent`, `multiple-baselines`, `revision-cycle`, `revision-fork`, `revision-digest-mismatch`, `req-dropped`, `incomplete-snapshot`, `invalid-req-clause`, `duplicate-req`, `replacement-alias-overlap`, `replacement-cycle`, `approval-missing`, `approval-not-independent`, `approval-content-mismatch`, `invalid-transition`, `stale-draft-base`, `migration-record-missing`, `migration-record-mismatch`, `immutable-revision-modified`, `immutable-revision-deleted`, `legacy-frozen-modified`, `duplicate-id`, `alias-collision`, `unknown-domain`, `invalid-id` and `role-mismatch`. Retirement eligibility uses the validated effective prefix and blocks on these authority findings regardless of ratchet severity; this prevents a known identity, alias or REQ collision from authorizing a new retirement. Namespace and REQ collisions are computed before the final prefix and supersession/conflict projection. Index current-state display uses the same blocker taxonomy with error severity: an error on the graph-selected current revision or a required effective ancestor produces `state: invalid; current: none`, while warnings stay visible in Unresolved without revoking `valid/current`. A pending descendant cannot discard an earlier valid effective prefix or its historical retirement event. The unresolved list also includes resolution diagnostics `malformed-frontmatter`, `missing-id`, `missing-req`, `unresolved-ref`, `ambiguous-legacy-ref`, `invalid-ref`, `missing-status`, `supersede-status-mismatch`, `supersede-cycle`, `recorded-conflict` and `prd-migration-required`; these remain visible at their reported severity but do not themselves block retirement eligibility or current-state display. When `buildIndex` receives no `diagnostics`, it runs `analyzeDocs` with the supplied options (including trusted-base inputs) and renders that result; callers that provide precomputed diagnostics must provide diagnostics from the same analysis context, with its graph and validated-prefix set, for equivalent retirement and current-state output.
