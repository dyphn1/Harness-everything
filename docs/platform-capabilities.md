# Platform Capability Matrix

This document is the repository-wide source of truth for **current platform integration and enforcement claims**. Other current-state documents may summarize this table, but they must not contradict it.

The key distinction is between **what Harness packages**, **what the host can mechanically enforce**, and **what has been live-verified**. Shared skill text alone does not prove mechanism parity.

## Current capability matrix

| Surface | Skills | Native/runtime mechanism | Current claim boundary |
| --- | --- | --- | --- |
| **Claude Code** | Yes | Native lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) | **Hard enforcement** for the supported gates covered by mechanism tests and live evidence. |
| **Codex / local OpenAI plugin** | Yes | `.codex-plugin` package with local `SessionStart` and `UserPromptSubmit` hooks | **Local invariant enforcement**: session policy + invariant-first routing are mechanically injected. Do not claim full Claude hook parity unless separate evidence exists. |
| **OpenCode** | Yes | Native plugin API (`tool.execute.before`, `tool.execute.after`, `session.idle`) | **Hard-capable implementation with mechanism coverage; live plugin loading remains unverified.** Do not promote this to live-verified enforcement without a real host-session artifact. |
| **Public OpenAI Skills-only plugin** | Yes | Public Skills-only bundle | **Skill/workflow behavior only.** The submitted artifact does **not** include the local `.codex-plugin` lifecycle hooks, so it must not claim `SessionStart`, `UserPromptSubmit`, or other local hooks as public hard enforcement. |
| **Cursor** | Yes | Project rules/instructions | Advisory only. |
| **Copilot Chat** | Yes | Repository custom instructions | Advisory only. |
| **Continue.dev** | Yes | Native project rule file | Advisory only. |
| **Hermes Agent** | Yes | Auto-loaded project context | Advisory only. |

## Codex has two supported paths

Do not collapse these into one capability claim:

1. **Legacy/general installer target** — `npx github:dyphn1/Harness-everything install --codex` writes Codex-facing skills/instructions such as `AGENTS.md`. That path is advisory where the host is only consuming instructions.
2. **Local OpenAI plugin package** — `plugins/harness-everything/.codex-plugin/plugin.json` packages the Harness skills plus local lifecycle hooks. Those hooks mechanically establish the compact session policy and invariant-first routing contract in supported local plugin workflows.

A statement such as "Codex is advisory only" is therefore incomplete. The correct claim depends on which installation surface is being discussed.

## Public OpenAI Skills-only boundary

The public submission path is intentionally narrower than the local plugin package. The generated upload contains the packaged `skills/` tree and referenced skill assets; it does not ship the local `.codex-plugin` hook adapter.

Therefore:

- reviewer cases measure reusable skill/workflow behavior;
- public listing text must not promise local hook enforcement;
- local Codex plugin mechanism evidence must not be presented as evidence that the public Skills-only bundle runs those hooks.

See [openai-plugin.md](openai-plugin.md) and [`../submission/openai/README.md`](../submission/openai/README.md).

## OpenCode evidence boundary

The OpenCode adapter uses the real plugin API and has deterministic mechanism coverage. That proves the implementation contract, but it is not the same as proving a real OpenCode host loaded and fired the plugin.

Until a live session artifact exists, current documentation must retain an explicit **live loading unverified** qualifier.

## Documentation policy

When platform behavior changes, update this file and every affected current-state surface in the same PR. At minimum inspect:

- `README.md`
- `docs/architecture.md`
- `VERIFICATION.md`
- `docs/mechanism-first-skill-mesh.md`
- `docs/troubleshooting.md`
- `docs/audit.md` when its latest-status prose would otherwise be misleading
- `docs/openai-plugin.md`
- `submission/openai/README.md`
- `opencode-plugin/README.md`
- release/change notes when the change is user-visible

`npm run test:docs:capabilities` enforces the current-state claim boundaries and is chained into `npm run test:consistency`.