# Error Ledger Bootstrap Workflow

## Inventory sources and privacy

Run `node "<this-skill-dir>/scripts/scan.js" --root "<target repo>"` with only the source options you intend to use. The scanner reads local Git history, repository `AGENTS.md` / `CLAUDE.md` instructions, and selected local memory or instruction files. Automatic memory is used only when the local memory directory can be associated with the target repository. Global instructions are included only when named with `--instructions <path>`.
At least two distinct `fix`/`revert` commits touching `*.md` or `docs/**` paths create documentation candidates.
`--tracker <file.json>` reads saved offline JSON arrays from `gh issue list` or `gh issue view`. The scanner never calls GitHub.
Bug/regression/flake labels or `fix`/`bug` title prefixes qualify; reports keep the issue reference and matching repo-existing paths, never issue bodies.

- `--memory <path>` selects local memory files; repeat it to select more paths.
- `--instructions <path>` explicitly selects local instruction files; repeat as needed.
- `--tracker <file.json>` selects an offline issue export; repeat it for additional files.
- `--no-memory` disables memory and instruction sources; docs and tracker sources remain enabled.
- `--hide-ledger` excludes existing error-ledger files from the scan.
- `--home <dir>` changes the local home used to resolve automatic memory.

Treat memory and instructions as private input. A local report may include opaque source IDs, a neutral generated title or a short summary the operator reviewed locally, and only site paths verified to exist in the target repository. Keep raw source text, excerpts, private filenames and paths, credentials, and personal identifiers out of both report formats. The scanner emits reports outside the target repository: by default, into a private temporary directory; `--out <dir>` must also resolve outside the target, including through symlinks. Keep both reports local, including for company repositories.

## Classify candidates locally

The report is an inventory of leads, not a ledger. Candidates start as `UNVERIFIED`; retain that status until evidence establishes an actual error class. During local classification, an operator may add a short reviewed summary. For each candidate, record the expected and observed behavior, affected sites, root-cause rule, and evidence that supports the classification. A recurring class needs independent occurrences, such as distinct commits or sources; repeated references to the same incident do not establish recurrence. Linked tests are attachments that may help locate evidence, not incidents themselves. Keep missing history unknown rather than treating it as zero. Do not write a record or index entry while classifying.

## Owner approval and promotion

Obtain explicit owner approval for each candidate. The approval must bind that exact candidate to the SHA-256 of its exact candidate report. A private-memory lead cannot be promoted based only on the memory note or an uncorroborated site: require independent durable provenance. Keep opaque local IDs and uncorroborated sites out of the E-record and index; write only record content from the owner-reviewed approval payload. The approval JSON field names and format are defined by `node "<this-skill-dir>/scripts/promote.js" --help`; use that contract rather than guessing. Do not promote an unapproved, changed, or stale candidate. Keep full candidate reports and private inputs out of E-records, PRs, shared logs, and uploads.

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
