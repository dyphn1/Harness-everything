# Release evidence

This is the repository-facing record of release observations. It separates a release that was actually published from a version that is only prepared in source control. Add a dated row after collecting all four observations in [RELEASING.md](../RELEASING.md).

## Observed release

The following evidence was collected on 2026-09-07 before the issue #20 integration work:

| Version | Registry observation | GitHub release | Workflow run | Gate and publish result |
| --- | --- | --- | --- | --- |
| 0.3.6 | `npm view harness-everything version dist-tags --json`: version and latest are `0.3.6` | `v0.3.6`, published 2026-09-01T03:50:44Z | [33466676632](https://github.com/dyphn1/Harness-everything/actions/runs/33466676632), commit `5aa74119d08ff241a7d6fe8f163a6a0d40c3c932` | `gate=success`, `publish=success` |
| 0.11.6 | `npm view harness-everything version dist-tags --json` (collected 2026-09-18): version and latest are `0.11.6` | `v0.11.6`, published 2026-09-18T12:51:58Z | [35346673284](https://github.com/dyphn1/Harness-everything/actions/runs/35346673284), commit `23d87db8230dcb524651dc67e932f54aa6f5c737` | `gate=success` (12/12 jobs incl. skill-quality, runtime-floor, self-regression x3 OS, consistency x3 OS, installer-e2e x3 OS, release-semantics), `publish=success` (job `release`) |

Intermediate versions between 0.3.6 and 0.11.6 were published via the same tag-driven workflow but were not individually ledgered here; the rows above are the two deliberately collected observations. A registry/GitHub listing alone is still not a completed row — each field must be a command output or inspectable URL.

The source capture for this row is the local review artifact `.git/issue-review-20260907/release-evidence.md`. That review artifact is not expected to be present in every checkout; it is historical evidence, not a release artifact shipped in the npm package.

## Current review boundary

This file is an evidence ledger, not a source of truth for the current package version. Historical rows stay unchanged until all four observations for a newer release are deliberately collected. Current release/runtime configuration must be read from Git history, package metadata, the release workflow, and [repository-contract.md](repository-contract.md), rather than from prose such as the retired `0.3.7-beta` review note.

A GitHub tag or source version alone is not enough to add a completed row here; keep using `not observed` when registry, workflow, or publication evidence has not been checked.

## Evidence entry template

Copy this row for each future release and replace every placeholder with command output or a directly inspectable URL:

| `<version>` | `npm view ...`: `<registry version and dist-tags>` | [`v<version>`](https://github.com/dyphn1/Harness-everything/releases) published `<UTC timestamp>` | [`<run-id>`](https://github.com/dyphn1/Harness-everything/actions) commit `<full SHA>` | `gate=<conclusion>`, `publish=<conclusion>` |

If a command fails or a field cannot be checked, record `not observed` instead of converting the missing observation into a success claim.
