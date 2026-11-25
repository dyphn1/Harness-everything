# Error Ledger Bootstrap Workflow

## Inventory sources and privacy

Run `node "<this-skill-dir>/scripts/scan.js" --root "<target repo>"` with only the source options you intend to use. The scanner reads local Git history, repository `AGENTS.md` / `CLAUDE.md` instructions, and selected local memory or instruction files. Automatic memory is used only when the local memory directory can be associated with the target repository. Global instructions are included only when named with `--instructions <path>`.
At least two distinct `fix`/`revert` commits touching `*.md` or `docs/**` paths create documentation candidates.
`--tracker <file.json>` accepts a top-level JSON array saved offline, for example `gh issue list --json number,title,labels,body > issues.json`. The scanner never calls GitHub.
Bug/regression/flake labels or `fix`/`bug` title prefixes qualify; reports keep the issue reference and matching repo-existing paths, never issue bodies.

- `--memory <path>` selects local memory files; repeat it to select more paths.
- `--instructions <path>` explicitly selects local instruction files; repeat as needed.
- `--tracker <file.json>` selects an offline issue export; repeat it for additional files.
- `--no-memory` disables memory and instruction sources; docs and tracker sources remain enabled.
- `--hide-ledger` excludes existing error-ledger files from the scan.
- `--home <dir>` changes the local home used to resolve automatic memory.

## Optional local error store

Local observations are opt-in: `--source local-store --destination harness|project`. With no `--source` option, the scanner keeps the legacy report bytes and source set. `--destination` is required with this source and accepts only `harness` or `project`; it is the operator's declaration for the canonical Git `--root`.

The scanner derives the workspace key from that root, calls the supported reader as `listRecords({ workspaceRoot, workspaceKey })`, and accepts only returned rows carrying that key. A bound host workspace that disagrees fails closed. The report binds the resolved destination to an opaque `workspaceRef`; each record ref is `p-local-<sha256>` over the workspace key and validated stored provisional ID. Raw provisional IDs are never reported. If the reader contract is absent (including the packaged Skills-only copy), the scan succeeds with source status `unavailable` and reason `reader-unavailable`.

The `local-store` source status is `used`, `missing`, `unverified`, or `unavailable`. Missing indexes use `index-missing`; unreadable or corrupt input uses a sanitized reason such as `store-unreadable`, `store-corrupt`, or `store-unsupported`. An empty reader result is `unverified` (`empty-reader-result`) because the reader returns an empty array for both an empty workspace and several read failures. Invalid rows are skipped and counted as `malformed`; they are never quoted. The report separately counts valid rows assigned to another destination and rows whose destination is `unknown`.

Each valid destination-matched provisional lesson yields one neutral local lead. Occurrences are grouped by exact signature and suppressed when a selected lesson covers that signature. JSON and Markdown contain only opaque refs, validated destination/kind/command-class metadata, signatures, counts, and dedupe/evidence results. They never include excerpts, cues, lesson text, issue URLs, paths, session IDs, or tool-use IDs. Keep the reports local; the local store and destination ledger are read-only during scan.

Each lead's `local` object includes `evidenceReadiness: needs-evidence`, `occurrenceCount`, and `dedupe`. The dedupe object contains `status` (`none`, `existing`, `ambiguous`, or `unverified`), sorted `classIds`, sorted `matchedBy` values (`signature` and/or `whole-rule`), and `newClassEligible`. The scanner checks only the selected destination's `index.jsonl`: a unique exact signature or exact whole-rule match (validated with the existing matcher validator) reports `existing` and its E-ID; matches to multiple E-IDs report `ambiguous`; an unreadable index reports `unverified`; otherwise the status is `none`. Only `none` sets `newClassEligible: true`, and that means only that exact dedupe found no existing class. The local lead still needs independently corroborated Git or documentation evidence and fresh item approval before promotion. Fuzzy matches remain for local classification.

Treat memory and instructions as private input. A local report may include opaque source IDs, a neutral generated title or a short summary the operator reviewed locally, and only site paths verified to exist in the target repository. Keep raw source text, excerpts, private filenames and paths, credentials, and personal identifiers out of both report formats. The scanner emits reports outside the target repository: by default, into a private temporary directory; `--out <dir>` must also resolve outside the target, including through symlinks. Keep both reports local, including for company repositories.

## Classify candidates locally

The report is an inventory of leads, not a ledger. Candidates start as `UNVERIFIED`; retain that status until evidence establishes an actual error class. During local classification, an operator may add a short reviewed summary. For each candidate, record the expected and observed behavior, affected sites, root-cause rule, and evidence that supports the classification. A recurring class needs independent occurrences, such as distinct commits or sources; repeated references to the same incident do not establish recurrence. Linked tests are attachments that may help locate evidence, not incidents themselves. Keep missing history unknown rather than treating it as zero. Do not write a record or index entry while classifying.

## Owner approval and promotion

Obtain explicit owner approval for each candidate. Bind the approval to the exact report with `candidateId` (the candidate's 20-character report ID) and `reportSha256` (the SHA-256 of the report file's exact bytes). A private-memory lead cannot be promoted based only on the memory note or an uncorroborated site: require independent durable provenance. Keep opaque local IDs and uncorroborated sites out of the E-record and index; write only record content from the owner-reviewed approval payload.

The top-level approval JSON has `schemaVersion: 1`, a 20-character hexadecimal `candidateId`, a 64-character hexadecimal `reportSha256` of the exact report bytes, an absolute canonical `targetRoot` matching `--target`, a non-empty `approvedBy`, and a parseable `approvedAt` timestamp. Its `record` object has a kebab-case `signature`; non-empty `class`, `title`, `violates`, and `sourcesNote`; `scope` of `in`, `out`, or `unresolved`; `status` of `open`, `lesson`, or `mechanism`; and `sites`, an array of existing target-repository files named by relative paths without absolute paths or `.` or `..` components. Do not put absolute paths in `approvedBy`, `approvedAt`, or the record text fields. The approved candidate must occur exactly once in the report, and the selected and approved site files must exist in the target.

Use this complete example as the approval file structure, replacing the sample candidate ID and digest with the exact report values, `targetRoot` with the target's absolute canonical path, and the approver, timestamp, and reviewed record content with the owner's approval:

```json
{
  "schemaVersion": 1,
  "candidateId": "0123456789abcdef0123",
  "reportSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "targetRoot": "/absolute/path/to/target",
  "approvedBy": "Owner Name",
  "approvedAt": "2026-11-20T00:00:00.000Z",
  "record": {
    "signature": "documented-fixture-bootstrap",
    "class": "process",
    "title": "Documented fixture bootstrap",
    "violates": "Describe the observed expected-versus-actual behavior",
    "scope": "in",
    "status": "lesson",
    "sites": ["README.md"],
    "sourcesNote": "Summarize the owner-reviewed evidence and lesson."
  }
}
```

Do not promote an unapproved, changed, or stale candidate. Keep full candidate reports and private inputs out of E-records, PRs, shared logs, and uploads.

Promotion requires the target to already contain `.agents/harness-everything/errors/`. Before the first promotion, create that directory once:

```sh
mkdir -p "<target repo>/.agents/harness-everything/errors"
```

Promotion refuses when the directory is absent. No index file is needed beforehand; successful promotion updates the index through the sync command below.

Before promotion, resolve a trusted local Harness checkout containing `scripts/errors-sync.js` and verify its Node dependencies are installed. The current sync script requires `js-yaml`; a read-only preflight is:

```sh
test -f "<Harness checkout>/scripts/errors-sync.js"
node -e "require.resolve('js-yaml', {paths: [process.argv[1]]})" "<Harness checkout>"
```

Promote with the packaged script:

```sh
node "<this-skill-dir>/scripts/promote.js" --target "<target repo>" --report "<report.json>" --approval "<approval.json>" --harness "<Harness checkout>"
```

Promotion writes one approved `E-xxxx-<slug>.md` record and updates the target index by running `node "<Harness checkout>/scripts/errors-sync.js" --root "<target repo>"`. The checkout's `--root` option is required so the target index, not the Harness checkout's own index, is regenerated. If no trusted checkout or dependency set is available, stop before promotion and leave the report local. Recover by checking out the trusted Harness source locally, running `npm ci` in that checkout, repeating the read-only preflight, then retrying the approved promotion.

## Windows paths

Quote paths passed to Node, especially when they contain spaces, and use the full repository path for `--root`. Keep explicit report output outside the target repository; the scanner resolves symlinks and checks containment. Do not determine containment with a bare `path.relative(...).startsWith('..')`: another drive can produce an absolute relative result, and a child named `..cache` is still inside. When writing path tests, use the same canonical root as the product and exercise Windows rules with `path.win32` on every host.
