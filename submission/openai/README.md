# OpenAI Public Plugin Submission

This directory contains repository-owned source material for OpenAI’s public **Skills only** plugin submission portal. It is separate from both the local `.codex-plugin` package manifest and the managed-workspace marketplace manifests.

## Build the final skills bundle

Run:

```bash
npm run plugin:sync
npm run plugin:submission:build
```

The builder writes:

```text
dist/openai-submission/
├── harness-everything-skills.zip
└── harness-everything-skills.manifest.json
```

The ZIP contains a portable root `plugin.json` and the synchronized skill tree under `skills/`. The builder takes the identity and listing interface from the local portable manifest. The archive excludes the local hook configuration, MCP definitions, and app wrappers. The manifest records every file path, byte count, content hash, and final bundle SHA-256. Rebuilding the same revision must produce the same bundle hash.

## Official portal workflow

1. Select the publishing organization and project. Organization owners can submit. Other members need **Apps Management: Write**. Complete individual or business identity verification.
2. In the OpenAI Platform Plugins page, select **Upload new or existing plugin**, choose the verified developer identity, and upload `harness-everything-skills.zip`.
3. Review the imported listing in **Metadata & Skills**. Resolve scan findings and complete the requested listing, logo, and availability fields using `listing.json`.
4. Run the smoke cases in `test-cases.json` against the prepared plugin in a fresh host session. The documented five-positive and three-negative app review requirement applies to initial MCP app review. Harness uses these cases for its own Skills-only smoke test.
5. Submit for review when the portal is ready. After approval, publish and confirm that a fresh eligible account can find and install the public listing.

See [Submit a plugin](https://developers.openai.com/plugins/deploy/submission) and the [submission error reference](https://developers.openai.com/plugins/deploy/submission-errors).

## Public submission boundary

The public **Skills only** bundle contains skills, scripts, templates, and assets referenced by those skills. It does not contain the local `.codex-plugin` lifecycle hooks. Therefore public review material must not claim that `SessionStart`, `UserPromptSubmit`, or other host-specific hooks provide hard enforcement in the published artifact.

The skills still provide routing, verification, failure recovery, TDD, security review, documentation, and other reusable workflow guidance. The test cases evaluate those workflows against the final skills tree rather than depending on local hook execution.

## Manual requirements and evidence boundary

CI cannot complete these portal operations:

- verify the developer or business identity;
- confirm **Apps Management: Write** access;
- upload or confirm a production logo;
- select countries/regions and complete attestations;
- run reviewer cases in the final host environment;
- submit, receive approval, or publish to the public directory.

The repository checks establish package evidence. Keep the ZIP digest and source revision with the portal scan or submission result, then retain the approval and the fresh-account install result when available.

## Repository checks

Run:

```bash
npm run test:plugin:openai
npm run test:plugin:submission
```

The checks verify listing metadata, public URLs, and the project smoke cases. They also verify deterministic bundle generation, ZIP entry names and hashes, and that the public manifest omits local hook settings.
