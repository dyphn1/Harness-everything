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

Do not hard-code a "current release baseline" in this guide. `semantic-release` discovers the latest stable tag from Git history on each run, and release evidence belongs in [docs/release-evidence.md](docs/release-evidence.md).

## Runtime contract

The release job uses the repository's primary Node runtime from the checked-in current-state policy: Node.js 24 today, with Node.js 22 retained as the minimum supported product runtime. The generated source-of-truth summary is [docs/repository-contract.md](docs/repository-contract.md).

When changing Node versions, GitHub Action majors, or workflow triggers, run:

```bash
npm run docs:sync
npm run test:repo-contract
```

## Release flow

A push to `main` runs the full reusable CI gate and then semantic-release. A manual `workflow_dispatch` run is available for a safe retry.

1. Check out full Git history and tags.
2. Run the same CI jobs used for pull requests, including the Node 22 minimum-runtime compatibility lane.
3. Analyze Conventional Commits since the latest stable release.
4. Exit without publishing when there is no releasable commit.
5. Calculate the next stable SemVer.
6. Run `scripts/sync-release-version.js` to synchronize package, Claude, OpenAI/Codex, OpenCode, lockfile, and changed canonical skill version fields.
7. Regenerate and verify plugin packages, then generate and validate the release-only `sbom.cdx.json` CycloneDX file.
8. Update `CHANGELOG.md` and create `chore(release): X.Y.Z [skip ci]`.
9. Create tag `vX.Y.Z`, publish npm with provenance (including the generated SBOM), and create the GitHub Release.

The SBOM is generated from the release `package.json`/`package-lock.json` and is intentionally not committed to Git. npm packaging is tested to ensure `sbom.cdx.json` is included in the published tarball.

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
- `metadata.version` for canonical skills changed since the previous release tag; when a top-level skill changes, all nested sub-skill `SKILL.md` files inherit that same release version

Unchanged skills keep the version of the release in which they last changed. This preserves useful per-skill provenance while removing manual version edits from normal PRs.

The release workflow passes the previous stable tag explicitly:

```bash
node scripts/sync-release-version.js 1.2.3 --base v1.2.2
node scripts/sync-release-version.js --check 1.2.3 --base v1.2.2
node scripts/sync-release-version.js --validate 1.2.3
```

Prerelease/build suffixes such as `1.2.3-beta` or `1.2.3+meta` are rejected.

The release SBOM can be checked independently with:

```bash
npm run test:release:sbom
```

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
