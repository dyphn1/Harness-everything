# Releasing Harness Everything

Harness releases are stable SemVer releases generated automatically from Conventional Commit history on `main`. Do not manually choose or bump a release version in normal pull requests.

## Version policy

`semantic-release` compares `main` with the latest stable `vX.Y.Z` tag and selects the highest required bump:

| Commit | Release |
| --- | --- |
| `BREAKING CHANGE:` footer or breaking `!` | major |
| `feat:` | minor |
| `fix:` / `perf:` / `refactor:` / `build:` / `revert:` | patch |
| `docs:` / `test:` / `ci:` / `style:` / `chore:` | none |

There are no alpha, beta, or rc release channels. Historical prerelease tags remain history, but new releases come only from `main` and use `vX.Y.Z` tags.

The migration baseline is the latest stable release tag, currently `v0.3.6`. Existing unreleased manifest strings do not determine the next version; Git history after that tag does.

## Release flow

A push to `main` runs the full reusable CI gate and then semantic-release. A manual `workflow_dispatch` run is available for a safe retry.

1. Check out full Git history and tags.
2. Run the same CI jobs used for pull requests.
3. Analyze Conventional Commits since the latest stable release.
4. Exit without publishing when there is no releasable commit.
5. Calculate the next stable SemVer.
6. Run `scripts/sync-release-version.js` to synchronize package, Claude, OpenAI/Codex, OpenCode, and lockfile version fields.
7. Regenerate and verify plugin packages.
8. Update `CHANGELOG.md` and create `chore(release): X.Y.Z [skip ci]`.
9. Create tag `vX.Y.Z`, publish npm with provenance, and create the GitHub Release.

Release concurrency is serialized so two updates to `main` cannot publish competing versions.

## Version ownership

The following checked-in fields are release outputs and are synchronized together:

- `package.json`
- `package-lock.json` and its root package entry
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugins/harness-everything/plugin.json`
- `plugins/harness-everything/.codex-plugin/plugin.json`
- `opencode-plugin/plugin.json`

Use the synchronizer only for release preparation or testing:

```bash
node scripts/sync-release-version.js 1.2.3
node scripts/sync-release-version.js --check 1.2.3
node scripts/sync-release-version.js --validate 1.2.3
```

Prerelease/build suffixes such as `1.2.3-beta` or `1.2.3+meta` are rejected.

## Contributor requirements

The final commit that lands on `main` must use a Conventional Commit type because it is release input. With squash merging, the PR title becomes especially important. Use `feat`, `fix`, `perf`, `refactor`, `build`, or `revert` when a shipped change needs a release, and use non-releasing types for changes that should not publish.

Keep human-authored pending notes under `[Unreleased]` in `CHANGELOG.md`; semantic-release owns stable release headings and release notes.

## Verification and evidence

The release workflow runs the reusable CI gate before semantic-release. After publication, verify the workflow, GitHub Release, and npm registry rather than inferring publication from source state:

```text
gh run list --workflow release.yml --limit 5
gh run view <run-id> --json conclusion,headSha,jobs
gh release view v<version> --json tagName,publishedAt,url
npm view harness-everything version dist-tags --json
```

Record release evidence in [docs/release-evidence.md](docs/release-evidence.md) when the release process requires an auditable observation.

## Failure and retry

A failure before tag/publication leaves no completed release. Running the workflow again against unchanged commit history calculates the same next version. Once a release tag exists, semantic-release treats it as the new baseline and will not republish that version. The generated release commit uses `[skip ci]` and a non-releasing `chore` type to prevent recursive releases.
