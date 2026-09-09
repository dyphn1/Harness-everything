# Releasing Harness

This document describes the maintainer release procedure for the npm package and Claude Code plugin. The release workflow already exists at [.github/workflows/release.yml](.github/workflows/release.yml); this document records the operator steps and the evidence required to say that a release happened.

## Prepare a release

1. Confirm the intended version is consistent in `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the changelog heading. A changelog entry marked `unreleased` is not a published release.
2. Run the local gates from a clean checkout:

   ```text
   npm ci
   npm test
   npm run test:mechanism
   npm run test:consistency
   npm run test:references
   npm run test:release
   npm run test:collision
   npm run test:routing:skills
   git diff --check
   ```

3. Review the complete diff and commit the release preparation. Do not publish from a working tree with unrelated changes.

## Tag and publish

Push an annotated tag whose name is the package version with a `v` prefix, for example `v0.3.7-beta`. The workflow rejects a tag whose version does not equal `package.json`.

```text
git tag -a v<version> -m "release: v<version>"
git push origin v<version>
```

The tag invokes the reusable CI workflow. It runs the pull-request gate on Ubuntu and Windows, the waza skill-quality gate, the installer check, and the release catalog check before the publish job runs `npm publish --provenance --access public`. A green local run or an existing workflow file is not evidence that npm accepted a package.

## Record release evidence

After the workflow completes, capture the run, release, and registry observations in [docs/release-evidence.md](docs/release-evidence.md):

```text
gh run list --workflow release.yml --limit 5
gh run view <run-id> --json conclusion,headSha,jobs
gh release view v<version> --json tagName,publishedAt,url
npm view harness-everything version dist-tags --json
```

Record the observed version, tag, commit SHA, workflow run URL, gate and publish conclusions, GitHub publication time, registry version, and dist-tags. If any observation is unavailable, write `not observed` and keep the release claim open. Do not infer npm publication from a successful build or from a changelog entry.

For the issue #20 umbrella status and its deferred evidence, see [docs/issue-20-rollup.md](docs/issue-20-rollup.md).
