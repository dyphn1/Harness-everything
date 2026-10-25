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

Codex and OpenCode are `Partial` in `liveHostVerification`. The Codex artifact verifies user-hook compatibility capture for two consecutive turns on one Windows Codex CLI host; native plugin-hook mounting and other host/version combinations remain unverified. OpenCode's retained evidence supports project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS), not durable hard enforcement. No fresh artifacts exist yet for the other surfaces, managed-workspace import, or public OpenAI approval.

### Routing contract vs. host evidence

The workflow plan controller rejects present non-array required/optional binding declarations before recording a requirement plan. This input-validation contract is covered by deterministic mechanism tests and does not change live-host evidence status.

The repository routing contract uses **step-scoped workflow selection**. Normalized keyword/domain signals help compose ordered requirements but never select or load document paths. Each step/stage declares its required and optional skill/reference bindings; only active bindings are disclosed, and required bindings resolve before the step/stage passes. Unknown or unavailable required bindings stay visible and unresolved; missing evidence produces reminders rather than a persistent workflow lock.

This is a **repository/agent contract**, not an automatic upgrade to any platform row below. A hook can prove that the contract was injected and record an agent's binding disposition; neither proves that a live host actually loaded or followed the referenced content. Instruction-only surfaces can carry the same rule without mechanically enforcing it. Promoting behavior to live-host compliance requires retained host/session evidence under the #82 compatibility program. Claude and local OpenAI packages carry workflow entry/completion **reminders** plus separate Rule-of-3/permission boundaries, but this package/mechanism change does not upgrade `platform-compatibility.json` live-host status values. See [workflow runtime](workflow-runtime.md) for scope, worktree isolation, and failure behavior. OpenCode and instruction-only/public Skills-only surfaces do not acquire equivalent runtime gating. Shell inspection is not a filesystem sandbox; absent hooks, agent-writable state, and indirect script effects remain limits.

## Current capability summary

| Platform surface | Standalone skills | Plugin support | Hooks/lifecycle | Project scope | Global scope | Current evidence boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `Supported` | `Mechanism verified` | `Partial`: user-hook compatibility capture is live-verified for `UserPromptSubmit` and `Stop` on one Windows Codex CLI host; native plugin hooks remain mechanism-verified | `.agents/skills/`, `AGENTS.md` | `~/.agents/skills/` | [Live evidence](../benchmarks/results/live-host/codex-2026-10-13/README.md) verifies two consecutive turns on Codex CLI 0.162.1; native plugin mounting, other lifecycle events, and other versions remain unverified. |
| ChatGPT / OpenAI Plugin | `Unknown` for a repository-local standalone path | `Mechanism verified` | `Partial`: local Work/Codex hooks are separate from ordinary Chat | Managed workspace marketplace | Not established | The public Skills-only bundle is mechanically reproducible; import, approval, and live behavior remain `Unknown`. |
| Claude Code | `Supported` | `Supported` | `Mechanism verified` for Harness configuration | `.claude/skills/` | `~/.claude/skills/` | Native Claude surfaces and the state-specific plugin sync command are mechanically checked; fresh-host execution is not preserved here. |
| OpenCode | `Supported` | `Partial` live-host loading for the project-scope, `.js`-filename install path on OpenCode 1.18.31 (macOS); other install paths remain `Mechanism verified` | `Partial` live-host evidence for project-scope `.js` loading and edit/verification state; hard lock reported only, with no retained blocked-tool trace and a post-reset final snapshot | `.opencode/skills/`, `.agents/skills/`, `.opencode/plugins/` | `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.config/opencode/plugins/` | [Retained evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md): loading and state effects verified in one host session; final snapshot post-reset; hard lock only an interactive observation; reflection operator-seeded, then agent-rewritten; no raw transcript or behavioral-effectiveness claim. `.mjs` auto-discovery broken (issue #127); global scope, npm-package installation, and other host versions remain unverified; V2 default-export load verified live on OpenCode 2.1.3 (macOS, 2026-10-23, server-log evidence only). |
| GitHub Copilot agent surfaces | `Supported` | `Unknown` for a Harness-specific plugin install | `Unknown` | `.github/skills/`, `.agents/skills/`, repository instructions | `~/.copilot/skills/`, `~/.agents/skills/` | GitHub Agent Skills paths and installer behavior are checked; no live Copilot session or plugin install is preserved. |
| Cursor | `Supported` | `Mechanism verified` for the portable package shape | `Unknown` for Harness | `.cursor/skills/`, `.agents/skills/` | `~/.cursor/skills/`, `~/.agents/skills/` | Official paths and package shape are checked; Cursor plugin loading and hooks remain unverified. |
| Continue.dev | `Unknown` for standalone `SKILL.md` discovery | `Unknown` | `Unknown` | `.continue/rules/` is documented; `.continue/skills/` is only an installer candidate | `~/.continue/skills/` is only an installer candidate | The reviewed official docs establish rules, not an Agent Skills host contract. |
| Hermes Agent | `Supported` | `Unknown` | `Unknown` | `.hermes/skills/` or trusted `.agents/skills/` | `~/.hermes/skills/` | Skill installation and ownership are tested; project loading still follows Hermes trust, and no live session is preserved. |

The full ten-dimension entries and official source URLs are in [platform-compatibility.json](platform-compatibility.json). “Supported” in the standalone-skills column refers to the host’s documented skill surface plus the repository’s verified path contract; it does not mean that a live Harness session was run on every platform.

### Claude Code Fable entrypoint boundary

The Claude plugin registers `./fable-mode` as the public Fable skill. The nested `fable-opus`, `fable-sonnet`, `fable-haiku`, and `execution-guardrails` directories are reference contracts inside that skill tree; they are not independently registered or host-routable Claude skills. The legacy prompts `fable on opus`, `fable on sonnet`/`sonnect`, and `fable on haiku` select Fable behavior profiles (orchestrator/reasoning/mechanical), not branded runtime models. `model-selector.js` records the profile and separately evaluates the host-specific advisory runtime floor; a below-floor or unknown runtime does not block Fable by itself.

The router distinguishes bounded profile explanations from Fable execution. Supported lookup prompts select `direct-single` and `references/profile-lookup.md`; the public skill dispatches before loading stage references. Entire explanation, format and negative-constraint clauses are checked against a bounded lookup vocabulary; comma/and-separated canonical output fields remain lookup data. Unknown continuations, same-clause actions (including `before`/`after`), mixed execution or macro scope retain execution routing and required invariants. This is a deterministic routing and packaged instruction contract, not a host-enforced reference-read limit or a measured token-cost guarantee.

The nested execution-guardrails file is also not an always-on carrier. Fable agents that need those rules carry them inline; any non-Fable surface must load, copy, or inject the rules through a carrier the host actually executes before claiming that they apply there.

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

The advisory installer text generated for Codex/Cursor/Copilot/Continue/Hermes carries the same step-scoped binding rule. That proves only what Harness writes, not that the host/model loaded or followed an active binding.

## Codex / local OpenAI plugin boundary

Codex has two paths that must not be collapsed:

1. The general `--codex` installer writes advisory `AGENTS.md` plus repo-scoped skills under `.agents/skills/`. Its generated instructions require resolving bindings declared for the active step, but this remains instruction-governed.
2. The local OpenAI plugin at `plugins/harness-everything/` packages the skills plus lifecycle hooks for session start, prompt routing, supported local tool calls, subagent lifecycle, and stop verification. Those hooks are mechanically checked. A separate live run verifies the user-hook compatibility fallback for prompt/stop observation only; native plugin hook mounting remains unverified.

The package remains subject to the host’s hook review/trust flow. The retained Codex CLI session proves that the selected user-level observation hooks were trusted and fired on one Windows setup; it does not prove that the model loaded or followed an active binding or that another ChatGPT/Codex installation loaded the same hooks.

### Native plugin install/update synchronization

The repository also ships a host-facing synchronization command for the native marketplace/plugin surfaces:

```bash
# POSIX shells / Git Bash
npx github:dyphn1/Harness-everything plugin-sync
# or, from a checkout:
./scripts/plugin-sync.sh

# Windows PowerShell
npx.cmd github:dyphn1/Harness-everything plugin-sync
# or, from a checkout:
node scripts/plugin-sync.js
```

The command detects Claude Code and Codex independently, ensures the Harness marketplace is configured, reads the installed-plugin state, then refreshes that marketplace before choosing the operation:

- absent plugin → install;
- existing Claude Code plugin → `claude plugin update harness-everything@harness-everything`;
- existing Codex plugin → `codex plugin marketplace upgrade harness-everything`;
- host without the plugin subcommands at all (a Codex build shipping only `codex plugin marketplace`) → register the marketplace source, then skip with an actionable capability-boundary reason;
- unknown plugin state → fail closed, with no blind install/re-add.

Mutating commands are issued with the current option set and retried without any option the host rejects, covering both commander wording (`unknown option '--json'`) and clap wording (`unexpected argument '--json' found`), so older Claude and Codex builds stay supported.

The installed branch is intentionally an update branch even when the current release is already the newest version; the host command may report “already latest.” Codex marketplace upgrade is the current native refresh operation. After successful Codex plugin install/update and verification, `plugin-sync.js` reads the installed plugin's tagged JSON source. It refreshes compatibility hooks only for `source: "local"` with an absolute filesystem path; `git`, `git-subdir`, `npm`, `remote`, unknown or missing variants, and relative paths fail closed before the installer runs. It does not reinterpret a repository subdirectory relative to the sync process working directory. An ownership/configuration error also makes Codex sync report failure. The installer does not alter trust state or private `config.toml`. Deterministic tests cover this source-shape policy; live Codex marketplace source reporting/sync remains unverified. The separate compatibility fallback has one retained live dispatch artifact on Windows, as recorded in the matrix.

On Windows, the synchronizer resolves `codex`/`claude` the same way an interactive shell does: it walks `PATH` directories in order and tries `PATHEXT` extensions within each directory before moving on, so directory order — not which candidate happens to be a directly launchable `.exe` — decides the match. This matters because Node's non-shell `spawnSync` cannot execute a `.cmd`/`.bat` shim directly and, left to its own resolution, can silently prefer an unrelated, older standalone `.exe` elsewhere on `PATH` over a newer npm-installed shim with no error to signal it. Only the one case Windows genuinely requires an interpreter for — a resolved `.cmd`/`.bat` target — is run through `ComSpec`, using the already-resolved absolute path rather than re-resolving the bare command name.

### Explicit Codex user-hook compatibility fallback

Current Codex documentation supports lifecycle hooks for manually installed Codex desktop plugins and requires users to review and trust non-managed hook definitions. The retained codex-cli 0.157.1 evidence records plugin_hooks as removed, so the user-hook compatibility installer remains necessary for that CLI path. Harness provides the compatibility path alongside the native plugin package:

```bash
harness codex-hooks install
harness codex-hooks status
harness codex-hooks uninstall
```

The installer copies the current packaged runtime into `$CODEX_HOME/harness-everything/compat-hooks/` and merges absolute-path entries into `$CODEX_HOME/hooks.json`. harness codex-hooks status reports `inactive` when the compatibility hooks are absent, or `configured-unverified` when their files are healthy; it cannot read Codex trust state. A successful Codex run of plugin-sync.js installs or refreshes this copy automatically. The installer does **not** modify `config.toml`, trust hashes, approval policy, or hook enablement. Codex must still show/review/trust the resulting non-managed hooks through its normal `/hooks` flow.

Updates retain at most two fingerprinted runtimes: the current runtime and the immediately previous distinct runtime. A third distinct install collects the oldest; sessions older than one update must restart. Reinstalling the same fingerprint preserves an intact previous runtime and drops a missing or modified one. `status` reports current and previous runtime file integrity separately and is unhealthy while a recorded previous runtime is missing or modified; this is filesystem health, not Codex hook trust or dispatch. Install, update, and uninstall hold an exclusive `compat-hooks.lock` directory for the whole manifest-read → runtime → hooks/manifest commit → collection transaction, so concurrent installers serialize instead of collecting each other's runtime. Each lock directory is created atomically together with its owner token. Acquisition and stale reclaim run under a short-lived `compat-hooks.lock.guard`, stale ownership is revalidated inside it, and a lock is removed only when it still carries the exact token judged stale; release likewise removes only the releasing holder's token. A lock or guard left by a dead local process is reclaimed, and a live lock times out (60 s) before any write. Uninstall removes all retained Harness-owned runtimes. Command paths remain fingerprinted: updates may require normal Codex hook review again; Harness does not bypass that security decision.

Installs of a plugin source tracked by a linked Git worktree refuse before writing. For an ordinary checkout, only modified or untracked files inside the plugin source subtree cause refusal. The runtime is built from the subtree's Git-tracked files, so `.gitignore`-excluded files (for example `.DS_Store` or `__pycache__`) are neither copied nor fingerprinted and do not block installation. The operator can explicitly pass `--allow-unreleased-source`. Packaged copies whose plugin manifest is not tracked by an enclosing repository remain supported, including copies inside an unrelated dirty repository. The mechanism and self-regression runners give child processes temporary HOME/USERPROFILE and CODEX_HOME directories. Tests must pass temporary Codex homes or mock the hook installer; mocking host commands alone does not isolate filesystem writes.

Ownership is deliberately strict: update/uninstall removes only exact entries recorded in the Harness compatibility manifest. If an installed Harness entry was edited after installation, the operation fails closed rather than overwriting or deleting that user-modified entry. Unrelated pre-existing and later-added user hooks are preserved.

The compatibility path registers hook commands in Codex user configuration and covers the missing plugin-mount route where user hooks dispatch. It does not repair a Codex carrier that fails to dispatch `PreToolUse` at all; those host-level execution-path limitations remain a live compatibility boundary.

The public OpenAI Skills-only plugin is narrower again. Its ZIP contains the packaged `skills/` tree and referenced files, but not the local `.codex-plugin` lifecycle hooks. Public submission readiness is therefore a package/form contract, not evidence of public-directory approval or live hook execution.

### Codex explicit UserPromptSubmit consent (mechanism only)

Codex has a local `UserPromptSubmit` exact-challenge consent path for a blocked
structured mutation. The blocked call exposes a pending challenge scoped to host
session, tool name, and canonical full tool-input digest. The pending challenge has
no wall-clock TTL. Only a real
`UserPromptSubmit` hook receiving the exact entire prompt
`HARNESS APPROVE <challengeId>` with no additional text can bind that challenge to
a host session and consent turn. The resulting one-use grant only lets the
matching retry pass Harness's guard; it does not emit `permissionDecision=allow`
and does not supersede native Codex permissions. Missing, mismatched, cross-session, cross-turn, and replayed grants remain
blocked. The one-use grant is bound to the consent turn and fails after a turn
change. Tool-input
authorization JSON never grants. This is cooperative local hook state: it is not
tamperproof and carries no live-host verification. Codex ask-style decisions are
not supported.

## Install/uninstall ownership boundary

The general installer merges shared files only through Harness-owned markers and removes only manifest-tracked artifacts. Malformed configuration and pre-existing user-owned files fail closed. Install/uninstall round-trip coverage protects user skills and runs on Linux, Windows, and macOS fixtures.

## OpenCode boundary

The OpenCode adapter targets the V2 plugin contract: it default-exports
`{ id: "harness.enforcement", setup(ctx) }` that registers
`ctx.tool.hook("execute.before|after")` and `ctx.event.subscribe()` through the
OpenCode 2 plugin context, and keeps the V1-shaped `HarnessEnforcement` factory
for OpenCode 1.x hosts. OpenCode 2 rejects named-export-only plugins with
`Plugin must export a default definition with an id and an effect or setup
function`; that failure (observed on OpenCode 2.1.3, macOS) and the recovery
after the V2 entrypoint were verified live on one host, with retained evidence
in the OpenCode server log only (loading succeeded after a plugin-file
reload; no hook-fire artifact). The adapter itself has deterministic mechanism
coverage (`ci/mechanism-2n-opencode-plugin.test.js`, V1 shapes;
`ci/mechanism-2p-opencode-v2-entrypoint.test.js`, V2 shapes). Retained
evidence supports project-scope `.js` loading and edit/verification state on
OpenCode 1.18.31 (macOS): [live-host evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md). The
retained snapshot predates #190 and remains historical evidence only. Current OpenCode removes the permanent post-reflection hard lock; only the third-failure reflection boundary pauses edits. Reflection was operator-seeded, then agent-rewritten, so do not promote this into a behavioral-effectiveness claim. `.mjs` auto-discovery is broken on this host version (issue #127). npm-package installation and behavioral V2-hook fire remain unverified.

## Official sources

The matrix records the official documentation reviewed for each platform. Important source families include [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenAI public submission](https://developers.openai.com/plugins/deploy/submission), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude skills](https://code.claude.com/docs/en/skills), [OpenCode skills](https://opencode.ai/docs/skills), [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Cursor skills](https://cursor.com/docs/skills), [Continue rules](https://docs.continue.dev/customize/rules), and [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

When a platform behavior changes, update this page, `docs/platform-compatibility.json`, and every affected current-state surface in the same change. `npm run test:docs:capabilities` and the compatibility mechanism suite enforce the repository-side contract; they do not replace manual live-host evidence.
# Experimental System One routing

The shared tier router supports opt-in `HARNESS_SYSTEM_ONE_MODE=shadow|prefer`
with a local CUA-S1 provider manifest (`HARNESS_SYSTEM_ONE_CONFIG`). Default `off`
retains existing behavior; `prefer` never lowers a tier below the deterministic
structural floor. Canonical and packaged runtime copies use the same
contract; this establishes no new live-host capability. Python, PyTorch and a
compatible local checkpoint are optional external dependencies, not npm payloads;
the explicit `npm run system-one:install` sets them up and hooks never run it.
With `transport: "resident"`, an opted-in router hook may spawn one detached
loopback-only Python server per manifest. One retained Windows + Claude Code
headless session showed the hook-spawned server outliving the host; macOS/Linux
and Codex hosts are not live-verified, and this does not change the matrix.
Hooks read the mode from the host process environment: Claude Code settings
`env` reaches hooks and every agent-run command, while a Codex started from an
ordinary terminal sees it only when set at user/OS level. Keep the mode `off`
until a Harness-trained checkpoint passes the rollout gates.
Public Skills-only artifacts do not acquire lifecycle hooks from this feature.
See [System One routing](system-one-routing.md) for limits, rollback and evidence.

The editorial doc check (`harness-everything/scripts/doc-check.js`, F1) is reached by instruction only: the `SKILL.md` deep-dive line leads to `references/triage-and-tiers.md`, whose governed-doc section names `references/doc-check.md`, which holds the command. No `doc-change` step binding exists. Evidence is package and mechanism only. It adds no host enforcement, no Stop lock and no trusted document credit, and a non-empty `coverage.unsupported` marks the check as partial.

`compare-derived` (`harness-everything/scripts/doc-check.js`, F3) compares a caller-captured generator output with a declared derived view, byte for byte. It runs no generator and writes no files. Its evidence is package and mechanism only: the generation status is caller-reported, and the output is ordinary command evidence. It is not trusted credit, and it makes no live-host claim.

Credited reconciliation for F4 (Claude Code only, pilot ON) is **implemented, with mechanism and package evidence and one live field-availability capture**. Credit works for `doc-lint` and `link-check` through a registered `doc-check` run, and for an independent `quality-review` with bound path digests. The capture under `benchmarks/results/live-host/claude-325-3b-s2b/` proves field availability on Claude Code 2.1.308 for one session. It is not live-host credit, and no live-host credit run exists yet. Deterministic mechanism tests (replay through the real hook entry points, with a CI-only qualification preloader) prove the chain.
