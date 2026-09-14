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

The ZIP contains exactly the synchronized `plugins/harness-everything/skills/` tree under `skills/`. It does not contain the local `.codex-plugin` lifecycle hooks, MCP definitions, or app wrappers. The manifest records every file path, byte count, content hash, and final bundle SHA-256. Rebuilding the same revision must produce the same bundle hash.

## Official portal workflow

1. Select **Create plugin**.
2. Choose **Skills only**.
3. Provide the listing metadata from `listing.json`.
4. Upload the final `harness-everything-skills.zip` bundle.
5. Provide the starter prompts and exactly five positive plus three negative reviewer cases from `test-cases.json`.
6. Select the verified developer/business identity, production logo, availability, and policy attestations.
7. Confirm the submitter has **Apps Management: Write** access.
8. Submit for review and publish only after approval.

Official documentation: [Submit a plugin](https://developers.openai.com/plugins/deploy/submission).

The review cases follow the documented shape. Each positive case includes a prompt, expected skill/workflow behavior, expected result shape, and fixture/account data. Each negative case includes a prompt/scenario, expected refusal/clarification/safe fallback, and a reason not to complete.

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

The repository therefore claims a reproducible, review-ready submission artifact only. It does not claim public-directory approval, managed-workspace import success, or live host execution until those external artifacts are preserved.

## Repository checks

Run:

```bash
npm run test:plugin:openai
npm run test:plugin:submission
```

The checks verify listing/manifest alignment, official-source metadata, public support/privacy/terms URLs, exactly five positive and three negative review cases, deterministic bundle generation, and exact file parity between the generated bundle manifest and the packaged skill tree.
