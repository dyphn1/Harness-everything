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

All `liveHostVerification` rows except OpenCode are `Unknown`. OpenCode's row is `Partial`: retained evidence supports project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS), not durable hard enforcement. No fresh artifacts exist yet for the other surfaces, managed-workspace import, or public OpenAI approval.

### Routing contract vs. host evidence

The repository routing contract uses **guidance-first workflow selection**. Each suggested skill still requires reading its complete `SKILL.md` entry/basic flow before omission; the selected topology is planning guidance and unresolved evidence produces reminders rather than a persistent workflow lock. A name, description, router summary, tier label, or generic “routine task” judgement is not enough skip evidence; unreadable suggestions are `unresolved/unavailable`, not silent skips.

This is a **repository/agent contract**, not an automatic upgrade to any platform row below. A hook can prove that the contract was injected into a session; it does not prove the model actually read every suggested skill. Instruction-only surfaces can carry the same rule without mechanically enforcing it. Promoting this behavior to live-host compliance requires retained host/session evidence under the #82 compatibility program. The Claude and local OpenAI packages carry workflow entry/completion **reminders** plus separate Rule-of-3/permission boundaries, but this package/mechanism change does not upgrade `platform-compatibility.json` live-host status values. See [workflow runtime](workflow-runtime.md) for scope, worktree isolation, and failure behavior. OpenCode and instruction-only/public Skills-only surfaces do not acquire equivalent runtime gating. Shell inspection is not a filesystem sandbox; absent hooks, agent-writable state, and indirect script effects remain limits.

## Current capability summary

| Platform surface | Standalone skills | Plugin support | Hooks/lifecycle | Project scope | Global scope | Current evidence boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `Supported` | `Mechanism verified` | `Mechanism verified` for the local OpenAI package, including session, prompt, supported-tool, subagent, and stop hooks | `.agents/skills/`, `AGENTS.md` | `~/.agents/skills/` | Local package hooks and the state-specific marketplace sync command are mechanically checked; live loading and marketplace refresh remain unverified. |
| ChatGPT / OpenAI Plugin | `Unknown` for a repository-local standalone path | `Mechanism verified` | `Partial`: local Work/Codex hooks are separate from ordinary Chat | Managed workspace marketplace | Not established | The public Skills-only bundle is mechanically reproducible; import, approval, and live behavior remain `Unknown`. |
| Claude Code | `Supported` | `Supported` | `Mechanism verified` for Harness configuration | `.claude/skills/` | `~/.claude/skills/` | Native Claude surfaces and the state-specific plugin sync command are mechanically checked; fresh-host execution is not preserved here. |
| OpenCode | `Supported` | `Partial` live-host loading for the project-scope, `.js`-filename install path on OpenCode 1.18.31 (macOS); other install paths remain `Mechanism verified` | `Partial` live-host evidence for project-scope `.js` loading and edit/verification state; hard lock reported only, with no retained blocked-tool trace and a post-reset final snapshot | `.opencode/skills/`, `.agents/skills/`, `.opencode/plugins/` | `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.config/opencode/plugins/` | [Retained evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md): loading and state effects verified in one host session; final snapshot post-reset; hard lock only an interactive observation; reflection operator-seeded, then agent-rewritten; no raw transcript or behavioral-effectiveness claim. `.mjs` auto-discovery broken (issue #127); global scope, npm-package installation, and other host versions remain unverified. |
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

The advisory installer text generated for Codex/Cursor/Copilot/Continue/Hermes carries the same read-before-skip rule. That proves only what Harness writes, not that the host/model complied with it.

## Codex / local OpenAI plugin boundary

Codex has two paths that must not be collapsed:

1. The general `--codex` installer writes advisory `AGENTS.md` plus repo-scoped skills under `.agents/skills/`. Its generated instructions require reading/evaluating every router-suggested skill before omission, but this remains instruction-governed.
2. The local OpenAI plugin at `plugins/harness-everything/` packages the skills plus lifecycle hooks for session start, prompt routing, supported local tool calls, subagent lifecycle, and stop verification. Those hooks are mechanically checked, but no live plugin/session artifact is committed.

The package is tested at the mechanism layer and remains subject to the host’s hook review/trust flow. A fresh host session is still required before claiming that a particular ChatGPT/Codex installation loaded and fired the hooks or that the model followed read-before-skip.

### Native plugin install/update synchronization

The repository also ships a host-facing synchronization command for the native marketplace/plugin surfaces:

```bash
npx github:dyphn1/Harness-everything plugin-sync
# or, from a checkout:
./scripts/plugin-sync.sh
powershell -File scripts/plugin-sync.ps1
```

The command detects Claude Code and Codex independently, ensures the Harness marketplace is configured, reads the installed-plugin state, then refreshes that marketplace before choosing the operation:

- absent plugin → install;
- existing Claude Code plugin → `claude plugin update harness-everything@harness-everything`;
- existing Codex plugin → `codex plugin marketplace upgrade harness-everything`;
- host without the plugin subcommands at all (a Codex build shipping only `codex plugin marketplace`) → register the marketplace source, then skip with an actionable capability-boundary reason;
- unknown plugin state → fail closed, with no blind install/re-add.

Mutating commands are issued with the current option set and retried without any option the host rejects, covering both commander wording (`unknown option '--json'`) and clap wording (`unexpected argument '--json' found`), so older Claude and Codex builds stay supported.

The installed branch is intentionally an update branch even when the current release is already the newest version; the host command may report “already latest.” Codex marketplace upgrade is the current native refresh operation; the command does not edit private cache paths or `config.toml`. These are deterministic command/state tests, not live-host evidence, so `liveHostVerification` remains `Unknown` in the matrix.

On Windows, the synchronizer retries through `ComSpec` when Node cannot directly start a CLI shim, so npm-installed `codex.cmd` and `claude.cmd` commands remain discoverable when the wrapper is launched from Git Bash.

### Explicit Codex user-hook compatibility fallback

Current Codex documentation supports plugin-bundled hooks, so native plugin mounting remains the preferred path. Some host/source combinations have nevertheless failed to expose enabled plugin hooks for review/entry attribution (#122 and upstream Codex reports). Harness therefore provides an **explicit compatibility fallback**, not an automatic replacement for native plugin hooks:

```bash
harness codex-hooks install
harness codex-hooks status
harness codex-hooks uninstall
```

The fallback copies the current packaged runtime into `$CODEX_HOME/harness-everything/compat-hooks/` and merges absolute-path entries into `$CODEX_HOME/hooks.json`. It does **not** modify `config.toml`, trust hashes, approval policy, or hook enablement. Codex must still show/review/trust the resulting non-managed hooks through its normal `/hooks` flow.

Ownership is deliberately strict: update/uninstall removes only exact entries recorded in the Harness compatibility manifest. If an installed Harness entry was edited after installation, the operation fails closed rather than overwriting or deleting that user-modified entry. Unrelated pre-existing and later-added user hooks are preserved.

This fallback solves only plugin-source discovery/mounting. It does not claim to repair a Codex carrier that fails to dispatch `PreToolUse` at all; those host-level execution-path limitations remain a live compatibility boundary.

The public OpenAI Skills-only plugin is narrower again. Its ZIP contains the packaged `skills/` tree and referenced files, but not the local `.codex-plugin` lifecycle hooks. Public submission readiness is therefore a package/form contract, not evidence of public-directory approval or live hook execution.

## Install/uninstall ownership boundary

The general installer merges shared files only through Harness-owned markers and removes only manifest-tracked artifacts. Malformed configuration and pre-existing user-owned files fail closed. Install/uninstall round-trip coverage protects user skills and runs on Linux, Windows, and macOS fixtures.

## OpenCode boundary

The OpenCode adapter uses the documented plugin API and has deterministic mechanism coverage. Retained evidence supports project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS): [live-host evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md). The retained snapshot predates #190 and remains historical evidence only. Current OpenCode removes the permanent post-reflection hard lock; only the third-failure reflection boundary pauses edits. Reflection was operator-seeded, then agent-rewritten, so do not promote this into a behavioral-effectiveness claim. `.mjs` auto-discovery is broken on this host version (issue #127). Global scope, npm-package installation, and other host versions remain unverified.

## Official sources

The matrix records the official documentation reviewed for each platform. Important source families include [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenAI public submission](https://developers.openai.com/plugins/deploy/submission), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude skills](https://code.claude.com/docs/en/skills), [OpenCode skills](https://opencode.ai/docs/skills), [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Cursor skills](https://cursor.com/docs/skills), [Continue rules](https://docs.continue.dev/customize/rules), and [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

When a platform behavior changes, update this page, `docs/platform-compatibility.json`, and every affected current-state surface in the same change. `npm run test:docs:capabilities` and the compatibility mechanism suite enforce the repository-side contract; they do not replace manual live-host evidence.
