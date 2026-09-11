# OpenAI / ChatGPT Plugin Packaging

Harness Everything ships an OpenAI plugin package under `plugins/harness-everything/` while the root skill directories remain the canonical source.

## Architecture

```mermaid
flowchart TD
    U([User prompt]) --> H[UserPromptSubmit hook]
    H --> K[Harness Kernel Router]
    K --> I[Required invariants]
    I --> A[Agent chooses useful domain skills]
    A --> E[Execute / inspect / edit]
    E --> V{Objective evidence?}
    V -->|yes| D[Evidence-backed completion]
    V -->|no| R[Diagnose and retry]
    R --> F{Same-signature failure x3?}
    F -->|no| E
    F -->|yes| Z[Zoom out / re-plan]
    Z --> E

    S[SessionStart hook] --> C[Cognitive OS policy]
    C --> K
```

The OpenAI adapter intentionally enforces only the cross-cutting invariants. Tier-specific skills remain advisory; the model may choose, combine, reorder, or skip them.

## Package layout

```text
plugins/harness-everything/
├── .codex-plugin/
│   └── plugin.json
├── hooks/
│   ├── hooks.json
│   └── session-start.js
└── skills/
    └── <26 canonical skills>
```

The package copies canonical root skill directories so ChatGPT/Codex receives the standard `skills/<name>/SKILL.md` layout. Do not edit packaged skill copies directly.

Run:

```bash
npm run plugin:sync
npm run test:plugin:openai
```

`plugin:sync` refreshes package copies from canonical skill directories. `test:plugin:openai` fails when the package drifts, a skill is missing/extra, the manifest/version is inconsistent, the marketplace path is invalid, hooks are missing, or packaged routing stops being deterministic.

## Install locally in ChatGPT desktop

The repository exposes a repo marketplace at `.agents/plugins/marketplace.json`.

1. Open this repository in ChatGPT desktop / Work or Codex.
2. Restart ChatGPT desktop after pulling marketplace or plugin changes.
3. Open the **Plugins Directory** and choose **Harness Everything Local**.
4. Install **Harness Everything**.
5. Review and trust the bundled command hooks when prompted. Changed hook definitions require review again.
6. Start a new chat for behavior tests.

The local install is copied into ChatGPT/Codex's plugin cache; after modifying the package, refresh the repository copy and restart the desktop app before retesting.

## Current compatibility boundary

This first OpenAI package validates the architecture-critical layer:

- all 26 skills are discoverable from one plugin;
- `SessionStart` injects the compact Cognitive OS policy;
- `UserPromptSubmit` executes the invariant-first kernel before peer skill selection;
- Linux and Windows hook commands are declared;
- routing is deterministic for identical input.

It does **not** claim full parity with every Claude-specific enforcement hook or the Claude `agents` manifest field. Those remain explicit compatibility work under issue #72 and must be proven with live host evidence before being labeled hard enforcement.
