# Issue #20 umbrella rollup

This rollup turns issue #20's historical checklist into bounded acceptance decisions. The review snapshot is `main` at `ba7853b`, checked on 2026-09-07. The umbrella owns coordination and release evidence; implementation details remain with the linked issue.

## Workstream decisions

| Workstream | Evidence in the review snapshot | Acceptance state | Remaining claim boundary |
| --- | --- | --- | --- |
| #37 opencode enforcement | The real plugin API is implemented and mechanism coverage exists in `ci/mechanism-2n-opencode-plugin.test.js`; the integrated reflection lifecycle is `d790e7f` on the integration branch. | Integrated, pending final integration gates | No live opencode loading or session smoke evidence was available; do not claim live enforcement. |
| #52 behavioral transcript parsing | Claude stream fixtures and parser coverage are integrated in `77efb06`; deterministic parser tests are available. | Integrated, pending final integration gates | No new paid behavioral rerun is part of this umbrella. Parse failures and missing tool visibility remain evidence states, not skill failures. |
| #42 workspace identity and migration | Workspace-keyed state and migration coverage are integrated in `9dd2e3d`; the issue review identified session and migration acceptance as the relevant boundary. | Integrated, pending final integration gates | Do not claim every host/session migration path is live verified until the integration gate and targeted fixtures pass. |
| #43 multi-agent workspace layout | The reviewed plan makes its root contract depend on #42. No implementation commit was present in the issue #20 review snapshot. | Deferred to its owner | Do not duplicate its layout or runtime work in this umbrella. |
| #44 progressive disclosure | Documentation and reference checks are integrated in `b33f598`; `ci/disclosure-check.js` and its mechanism coverage are present. | Integrated, pending final integration gates | This records repository documentation evidence; it does not establish behavioral-model effectiveness. |
| #56 behavioral rubric triage | The review found grader/source-boundary issues, including `command_exit_0` proving the grader command rather than the agent action. | Deferred to its owner | Do not reuse the historical pass-rate claims until the rubric and trace evidence are corrected. |
| Extended 100-case study | The original issue proposed 100 cases, but the review did not establish a decision threshold or clean attribution between skill text, plugin enforcement, and grader behavior. | Explicitly deferred | No uncontrolled 100-case run is authorized by this rollup. Define paired design, failure taxonomy, and decision rule first. |
| Release | The tag-triggered full gate and provenance publish workflow already exists. Historical `0.3.6` evidence is recorded in [docs/release-evidence.md](release-evidence.md). | Documentation complete; next release unproven | A prepared `0.3.7-beta` version is not evidence of a tag, npm publication, or GitHub release. |

## Focused acceptance checks

The integration owner should run these checks after incorporating the issue branches:

```text
npm test
npm run test:mechanism
npm run test:consistency
npm run test:references
npm run test:release
npm run test:collision
npm run test:routing:skills
```

The checks establish deterministic repository and routing health. They do not substitute for live opencode loading, a paid behavioral run, or npm/GitHub release evidence. Those claims require the artifacts named in [RELEASING.md](../RELEASING.md) and [docs/release-evidence.md](release-evidence.md).

## Historical evidence boundary

The local review artifact `.git/issue-review-20260907/release-evidence.md` records a successful `0.3.6` workflow (`33466676632`) and npm observation. It explicitly says that this is not proof of a `0.3.7-beta` release. This rollup preserves that distinction so an old successful release cannot be mistaken for current publication evidence.
