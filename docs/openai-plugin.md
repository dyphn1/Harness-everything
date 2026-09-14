# OpenAI / ChatGPT Plugin Packaging

Harness Everything ships an Agent Plugin package under `plugins/harness-everything/`. The root skill directories remain canonical; packaged copies are synchronized from them.

## Package layout

```text
plugins/harness-everything/
├── plugin.json                 # portable Agent Plugin manifest
├── .codex-plugin/plugin.json   # Codex compatibility manifest
├── hooks/                      # local OpenAI/Codex hook adapter
└── skills/                     # 26 synchronized canonical skills
```

The portable manifest follows the Agent Plugins schema and uses a root `skills/` directory. OpenAI-specific hook and interface metadata lives under `extensions.com.openai`; the compatibility manifest keeps the legacy `.codex-plugin` shape for clients that still expect it. These are two distribution manifests for the same package, not two different products.

The package is intentionally skill-only: it does not declare `mcpServers` or `apps`. Hooks are a local package capability and require the host’s trust/review flow; they are not a claim that every OpenAI surface provides the same lifecycle enforcement.

Run:

```bash
npm run plugin:sync
npm run test:plugin:openai
npm run test:plugin:submission
```

The checks compare the canonical and packaged skill trees byte-for-byte, validate both manifest forms, execute the local hook entry points, and verify deterministic routing.

## Managed ChatGPT workspace import

OpenAI documents GitHub marketplace import for workspace administrators. The repository provides both `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`; the source entry resolves to `plugins/harness-everything/`.

Use the repository URL as the source, leave Path empty so the marketplace is read from the repository root, and select the intended branch (normally `main`). In ChatGPT, use **Workspace settings > Plugins > Add > Import marketplace**, review the import results, and set the workspace installation policy. OpenAI documents automatic daily synchronization and a **Sync now** action for later refreshes.

This repository contains the marketplace/package artifacts and deterministic import-shape checks. It does not contain a managed-workspace import report or a fresh host smoke-test artifact, so those operations remain `Unknown` in the compatibility matrix.

Official documentation: [Importing and syncing plugin marketplaces from GitHub](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github) and [Plugins in Codex](https://help.openai.com/en/articles/20001256-plugins-in-codex).

## Local Codex / OpenAI package

The local package path is distinct from the general `--codex` installer. The general installer writes advisory `AGENTS.md` and repo-scoped `.agents/skills/`; the plugin package additionally contains local `SessionStart` and `UserPromptSubmit` hooks.

The package tests prove the following repository-side contract:

- the portable root manifest and `.codex-plugin` compatibility manifest agree on identity, version, interface, and hook entry point;
- the root `skills/` tree contains exactly the 26 canonical skills;
- Windows and POSIX hook commands resolve through `PLUGIN_ROOT`;
- the session hook emits the compact policy and the prompt hook invokes invariant-first routing;
- identical routing input produces identical output.

These are package/mechanism results. They do not prove that a live Codex or ChatGPT host loaded the package; a preserved host/session artifact is required for that claim.

## Public Skills-only submission

OpenAI’s public submission flow supports a **Skills only** plugin. This is separate from managed-workspace marketplace import and from the local hook-capable package.

Build the final upload from the synchronized package:

```bash
npm run plugin:submission:build
```

The generated ZIP contains only `skills/<name>/...` files from `plugins/harness-everything/skills/`. It does **not** include the local `.codex-plugin` lifecycle hooks, MCP definitions, or a fake app wrapper. The generated manifest records every path, byte count, file hash, and final bundle hash; repeated builds from the same revision must match.

The submission source files in [`../submission/openai/`](../submission/openai/) model the official review inputs: listing metadata, starter prompts, release notes, exactly five positive cases, and exactly three negative cases. Positive cases specify the prompt, expected skill/workflow behavior, expected result shape, and fixture/account data. Negative cases specify the prompt/scenario, expected refusal/clarification/safe fallback, and why completion is not appropriate.

The official portal flow is: **Create plugin → Skills only → upload the final skill bundle → provide review cases and listing metadata → complete identity, availability, policy, and access requirements → submit for review → publish after approval**. The repository cannot complete verified identity, logo upload, availability selection, Apps Management write access, review, approval, or public-directory publication.

Official documentation: [Submit a plugin](https://developers.openai.com/plugins/deploy/submission) and [Build plugins](https://developers.openai.com/plugins/build/plugins).

## Evidence boundary

The local plugin and public Skills-only artifact must not be conflated:

| Artifact | Repository evidence | Claim that is safe today |
| --- | --- | --- |
| Portable/root plugin package | Manifest, tree, hook, and routing mechanism tests | Package shape and local mechanism are verified |
| Managed workspace marketplace | Marketplace JSON and source-path checks | Import-ready repository artifact; live import remains unverified |
| Public Skills-only ZIP | Deterministic builder and 5+3 review-input checks | Reproducible skills bundle; approval and live public behavior remain unverified |

See the [platform capability matrix](platform-capabilities.md) for the complete ten-dimension status table and official source URLs.
