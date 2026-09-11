# OpenAI Public Plugin Submission

This directory contains repository-owned source material for the OpenAI public plugin submission portal. It is intentionally separate from `.codex-plugin/plugin.json`: the files here are review/form inputs and evidence, not an OpenAI import schema.

## Build the skills bundle

Run:

```bash
npm run plugin:submission:build
```

The command writes:

```text
dist/openai-submission/
├── harness-everything-skills.zip
└── harness-everything-skills.manifest.json
```

The ZIP contains the exact `plugins/harness-everything/skills/` tree under `skills/`. The manifest records every path, file hash, byte count, and the final bundle SHA-256. Running the builder twice against the same repository revision must produce the same bundle hash.

The generated `dist/openai-submission/` directory is not committed. Build it from the revision being submitted and preserve the generated manifest/hash as review evidence.

## Portal workflow

1. Open the OpenAI plugin submission portal.
2. Select **Create plugin**.
3. Choose **Skills only**.
4. Copy the listing fields from `listing.json`.
5. Select the verified developer/business identity for the publishing organization.
6. Upload a production-ready logo and choose the listed category.
7. Upload `harness-everything-skills.zip` in the Skills step.
8. Copy the starter prompts from `listing.json`.
9. Enter the five positive and three negative cases from `test-cases.json`.
10. Choose availability only where publisher/support/legal coverage is ready.
11. Copy the initial release notes from `listing.json`, complete policy attestations, and submit for review.

Official submission documentation: https://developers.openai.com/plugins/deploy/submission

## Public submission boundary

The public **Skills only** bundle contains skills, scripts, templates, and assets referenced by those skills. It does not contain the local `.codex-plugin` lifecycle hooks. Therefore public review material must not claim that `SessionStart`, `UserPromptSubmit`, or other host-specific hooks are hard enforcement in the published skills-only artifact unless OpenAI adds and validates an explicit submission mechanism for them.

The skills themselves still provide routing, verification, failure-recovery, TDD, security-review, documentation, and other workflow guidance. Tests in `test-cases.json` are written against those reusable workflows rather than depending on local hook execution.

## Manual requirements that CI cannot complete

- Verify the developer or business identity in the OpenAI Platform organization used to publish.
- Ensure the submitter has **Apps Management: Write** access.
- Upload/confirm the production logo in the portal.
- Choose country/region availability.
- Run the reviewer-facing cases in the final host environment.
- Submit for review, then publish only after approval.

## Repository checks

Run:

```bash
npm run test:plugin:openai
npm run test:plugin:submission
```

The submission check verifies listing/manifest alignment, public support/privacy/terms URLs, exactly five positive and three negative review cases, deterministic bundle generation, and exact file parity between the generated bundle manifest and the packaged skill tree.
