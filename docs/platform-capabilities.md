# Platform Capability Matrix

This is the repository-wide source of truth for current platform integration, installation, and enforcement claims. The machine-readable matrix is [platform-compatibility.json](platform-compatibility.json); this page explains its evidence boundaries and the most important operator-facing paths.

## Evidence policy

The matrix separates standalone Agent Skills from plugin support, bundled skills, lifecycle hooks, project/global scope, install/uninstall symmetry, assets/references, update/sync, and live-host verification. A package or deterministic mechanism test cannot be promoted to `Live verified` without a preserved real-host session, import report, or portal artifact.

Statuses are intentionally explicit:

- `Supported`: official/native host support and a verified Harness path.
- `Mechanism verified`: the repository package, adapter, or installer contract passes; a real host run is not confirmed.
- `Live verified`: preserved evidence shows a real host session or portal operation.
- `Partial`: only part of the capability is available or verified.
- `Unsupported`: official host documentation explicitly rules out the capability.
- `Unknown`: the capability or its current host behavior was not established.

All current `liveHostVerification` rows are `Unknown`. This checkout contains deterministic package and installer evidence, but no fresh host-session artifacts, managed-workspace import report, or public OpenAI approval record.

## Current capability summary

| Platform surface | Standalone skills | Plugin support | Hooks/lifecycle | Project scope | Global scope | Current evidence boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `Supported` | `Mechanism verified` | `Mechanism verified` for the local OpenAI package | `.agents/skills/`, `AGENTS.md` | `~/.agents/skills/` | Local package hooks are mechanically checked; live loading and marketplace refresh remain `Unknown`. |
| ChatGPT / OpenAI Plugin | `Unknown` for a repository-local standalone path | `Mechanism verified` | `Partial`: local Work/Codex hooks are separate from ordinary Chat | Managed workspace marketplace | Not established | The public Skills-only bundle is mechanically reproducible; import, approval, and live behavior remain `Unknown`. |
| Claude Code | `Supported` | `Supported` | `Mechanism verified` for Harness configuration | `.claude/skills/` | `~/.claude/skills/` | Native Claude surfaces are documented and package/installer checks pass; fresh-host execution is not preserved here. |
| OpenCode | `Supported` | `Mechanism verified` | `Mechanism verified` against `tool.execute.*` and `session.idle` | `.opencode/skills/`, `.agents/skills/`, `.opencode/plugins/` | `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.config/opencode/plugins/` | The real adapter API is tested, but live plugin loading remains unverified. |
| GitHub Copilot agent surfaces | `Supported` | `Unknown` for a Harness-specific plugin install | `Unknown` | `.github/skills/`, `.agents/skills/`, repository instructions | `~/.copilot/skills/`, `~/.agents/skills/` | GitHub Agent Skills paths and installer behavior are checked; no live Copilot session or plugin install is preserved. |
| Cursor | `Supported` | `Mechanism verified` for the portable package shape | `Unknown` for Harness | `.cursor/skills/`, `.agents/skills/` | `~/.cursor/skills/`, `~/.agents/skills/` | Official paths and package shape are checked; Cursor plugin loading and hooks remain unverified. |
| Continue.dev | `Unknown` for standalone `SKILL.md` discovery | `Unknown` | `Unknown` | `.continue/rules/` is documented; `.continue/skills/` is only an installer candidate | `~/.continue/skills/` is only an installer candidate | The reviewed official docs establish rules, not an Agent Skills host contract. |
| Hermes Agent | `Supported` | `Unknown` | `Unknown` | `.hermes/skills/` or trusted `.agents/skills/` | `~/.hermes/skills/` | Skill installation and ownership are tested; project loading still follows Hermes trust, and no live session is preserved. |

The full ten-dimension entries and official source URLs are in [platform-compatibility.json](platform-compatibility.json). “Supported” in the standalone-skills column refers to the host’s documented skill surface plus the repository’s verified path contract; it does not mean that a live Harness session was run on every platform.

## Installer target contract

The general installer’s target paths are tested independently from host discovery. This prevents a successful file copy from being reported as proof that an agent will load the file.

| Installer target | Project scope | User/global scope | Host-support note |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | Official skill locations |
| Cursor | `.cursor/skills/` | `~/.agents/skills/` | Official Agent Skills compatibility path |
| GitHub Copilot agent surfaces | `.github/skills/` | `~/.agents/skills/` | Official project/global Agent Skills paths |
| Codex | `.agents/skills/` | `~/.agents/skills/` | Official Agent Skills paths; `AGENTS.md` is separate instruction context |
| Continue.dev | `.continue/skills/` | `~/.continue/skills/` | Installer adapter candidate; host discovery is `Unknown` from reviewed official docs |
| Hermes Agent | `.agents/skills/` | `~/.hermes/skills/` | Project loading is subject to Hermes trust |

These targets apply to both default link mode and explicit `--copy` mode. A canonical store is only a deduplication detail; it cannot make an unsupported host path supported. Install/uninstall tests also protect user-owned files and cover Linux, Windows, and macOS round-trip fixtures.

## Codex / local OpenAI plugin boundary

Codex has two paths that must not be collapsed:

1. The general `--codex` installer writes advisory `AGENTS.md` plus repo-scoped skills under `.agents/skills/`.
2. The local OpenAI plugin at `plugins/harness-everything/` packages the skills and local `SessionStart` / `UserPromptSubmit` hooks. Those hooks are mechanically checked, but no live plugin/session artifact is committed.

The public OpenAI Skills-only plugin is narrower again. Its ZIP contains the packaged `skills/` tree and referenced files, but not the local `.codex-plugin` lifecycle hooks. Public submission readiness is therefore a package/form contract, not evidence of public-directory approval or live hook execution.

## Install/uninstall ownership boundary

The general installer merges shared files only through Harness-owned markers and removes only manifest-tracked artifacts. Malformed configuration and pre-existing user-owned files fail closed. Install/uninstall round-trip coverage protects user skills and runs on Linux, Windows, and macOS fixtures.

## OpenCode boundary

The OpenCode adapter uses the documented plugin API and has deterministic mechanism coverage. That proves the implementation contract only. **Live plugin loading remains unverified** until a real OpenCode session artifact demonstrates that the host loaded and fired the module.

## Official sources

The matrix records the official documentation reviewed for each platform. Important source families include [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenAI public submission](https://developers.openai.com/plugins/deploy/submission), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude skills](https://code.claude.com/docs/en/skills), [OpenCode skills](https://opencode.ai/docs/skills), [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Cursor skills](https://cursor.com/docs/skills), [Continue rules](https://docs.continue.dev/customize/rules), and [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

When a platform behavior changes, update this page, `docs/platform-compatibility.json`, and every affected current-state surface in the same change. `npm run test:docs:capabilities` and the compatibility mechanism suite enforce the repository-side contract; they do not replace manual live-host evidence.
