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

Codex, Antigravity (AGY), and OpenCode are `Partial` in `liveHostVerification`. The Codex artifact verifies user-hook compatibility capture for two consecutive turns on one Windows Codex CLI host; native plugin-hook mounting and other host/version combinations remain unverified. The AGY artifact covers global Desktop App `2.34.0` and `agy` CLI `1.5.15` (macOS), plus Windows Desktop and `agy` CLI `1.5.16` (`harness-everything` `1.0.1`), for plugin loading/validation and lifecycle hooks (including bounded 1-continuation `Stop` on Windows) under host-limited `PostToolUse` shell outcomes; IDE write tools, live `exitCode: 0` shell verification credit, live `model_stop`, and full project-scope isolation remain unverified. OpenCode supports the **V2 plugin API only** (OpenCode 1.x / V1 is unsupported): V2 live evidence covers one isolated `2.1.4` (macOS 26.6.2) long-lived server lifecycle trace (V2 default-export load, V2 tool hooks, V2 event envelope + `session.execution.succeeded`, and completion → verification → reminder delivery; standalone `opencode run` exits before verification finishes), earlier `2.1.3` macOS server-log load-only and `2.1.4` macOS workspace traces, and two isolated `2.4.1` (macOS 26.7.3) long-lived server runs establishing observation recording + idempotent training export (router/context injection indirectly observed via the model emitting the injected label contract, not a full injection trace) and mid-turn live steering delivery shape (witness-only for #450); ledger lessons, session create/delete reset, cancellation, global scope, npm-package install, and other versions/OSes remain unverified, while the retained OpenCode 1.18.31 (macOS) project-scope `.js` loading and edit/verification state artifact is historical/unsupported V1 evidence only. No fresh artifacts exist yet for the other surfaces, managed-workspace import, or public OpenAI approval.

### Codex PR metadata action-gate boundary

Exact title/body-only `update_pull_request` calls are Codex-only host-deferred mutations after an argument allowlist check; explicit required Gate hints and all additional fields retain the existing Gate. Native task scope, permissions and GitHub authorization remain authoritative. Canonical/package mechanism tests cover hashes, audit provenance, outcomes and negative controls; this does not establish candidate live-host coverage. See [Codex policy](codex-action-gate.md#codex-pr-titlebody-updates-host-deferred).

### Codex post-tool and subagent-stop hooks

Codex emits `PostToolUse` for both successful and failed shell commands. Harness
requires a structured zero exit status to credit shell verification or clear a
tracked shell failure. Text-only or missing status leaves verification and
recovery state intact and is audited as `unknown` for observed gated actions.
Edits are still tracked when the outcome is unknown because side effects may
already have occurred.

[Windows CLI 0.172.0 evidence](../benchmarks/results/live-host/codex-2026-11-26-488-post-tool-use/README.md)
shows that UnifiedExec with PowerShell and Git Bash delivers only a string in
`PostToolUse.tool_response`. A command that yielded and then completed through
`write_stdin` delivered an empty string response on both shells. Structured exit
status appears in the separate CLI event stream. Automatic verification credit
through the hook depends on Codex exposing structured status in the hook payload.

Codex `SubagentStop` uses the documented JSON `systemMessage` field for a UI-only
warning when the scope audit detects a new violation. Each audit advances the
Git status baseline and replaces `subagent-scope-last.json`. A later silent stop
can therefore coexist with unresolved changes. The coordinator owns
[scope reconciliation before accepting the result](../fable-mode/references/execution-phases.md#verification-and-handoff),
even when the hook is silent. The source and package fixtures cover these
behaviors. Windows host delivery remains to be verified.

### Antigravity Windows shell handoff

[AGY CLI 1.5.17 evidence](../benchmarks/results/live-host/agy-2026-11-26-516-read-only/README.md)
records live delivery of two read-only Windows shell probes to the packaged
AGY hooks. Both probes left edit and verification timestamps unset, and the
patched Stop hook allowed termination. These payloads omitted structured exit
status, so they could not grant automatic verification credit.

### Routing contract vs. host evidence

The workflow plan controller rejects present non-array required/optional binding declarations before recording a requirement plan. This input-validation contract is covered by deterministic mechanism tests and does not change live-host evidence status.

The repository routing contract uses **step-scoped workflow selection**. Normalized keyword/domain signals help compose ordered requirements but never select or load document paths. Each step/stage declares its required and optional skill/reference bindings; only active bindings are disclosed, and required bindings resolve before the step/stage passes. Unknown or unavailable required bindings stay visible and unresolved; missing evidence produces reminders rather than a persistent workflow lock.

This is a **repository/agent contract**, not an automatic upgrade to any platform row below. A hook can prove that the contract was injected and record an agent's binding disposition; neither proves that a live host actually loaded or followed the referenced content. Instruction-only surfaces can carry the same rule without mechanically enforcing it. Promoting behavior to live-host compliance requires retained host/session evidence under the #82 compatibility program. Claude and local OpenAI packages carry workflow entry/completion **reminders** plus independent permission boundaries, but this package/mechanism change does not upgrade `platform-compatibility.json` live-host status values. See [workflow runtime](workflow-runtime.md) for scope, worktree isolation, and failure behavior. OpenCode and instruction-only/public Skills-only surfaces do not acquire equivalent runtime gating. Shell inspection is not a filesystem sandbox; absent hooks, agent-writable state, and indirect script effects remain limits.

### Action-gate mechanism vs. host semantic boundary

Routine exact `create_pull_request` operations and Codex title/body-only
`update_pull_request` operations are host-deferred at the mechanism level:
their descriptor remains a mutation (not read/safe), and no Harness consent or
`permissionDecision` is emitted. Native agent task-scope authorization and native
permissions stay authoritative; an explicit required `actionGate` hint still gates.
This is a deterministic mechanism change, not live-host proof, and does not
upgrade any platform row's live-host status.

### Full-corpus conflict-check (mechanism only)

The registered `doc-check check --conflict-assessment` mode runs document lifecycle lint across the full governed and legacy corpus and requires `--base` as an exact commit SHA. It emits `conflict-check` only when collection is complete and there are no lifecycle errors. Its event preserves the exact obligation scope separately from full-corpus paths and digests, config bytes and base commit, then checks those bindings against the workflow snapshot. The acceptance is limited to recorded and structural conflicts; prose contradictions remain with independent `quality-review`. Plain `check` never earns this credit, and OpenCode still refuses the capability. Deterministic mechanism coverage does not establish live-host behavior or change the platform matrix's live-verification status.

### Self-evolve workspace resolution (mechanism only)

Source and packaged plugin self-evolve entrypoints use installation-relative canonical workspace helpers and the same workspace/session state path. Missing helpers, unresolved identities, and unusable state paths fail explicitly; only absent candidate directories yield an empty list. The [resolver contract](../self-evolve/references/memory-resolution.md#workspace-helper-and-diagnostics) and source/package subprocess regressions establish deterministic mechanism coverage, not a live-host upgrade. Existing memory authorization remains required.

### Error-ledger lesson injection (mechanism only, #394)

A shared matcher (`hooks/scripts/lib/ledger-match.js`) selects workspace ledger lessons whose `match` rules fit a direct `git commit` action (optionally after `-C`, `-c`, `--git-dir=`, `--work-tree=`, `--no-pager` or `-P`; compound and wrapped commands stay silent, #502) or its commitlint failure; rules are read from the generated index row and checked against the record's frontmatter binding, and the host carriers add the record's Cue and Lesson as model context: Claude Code `PreToolUse` and `PostToolUseFailure` (`hooks/scripts/ledger-lesson.js`), Codex `PreToolUse` and `PostToolUse` with outcome classification (`hooks/scripts/codex-ledger-lesson.js`, packaged and user-hook compatibility paths), and OpenCode V2 tool `execute.before/after` selection delivered through the next `context` hook, i.e. after the action. OpenCode 1.x / V1 is unsupported; lesson delivery targets the OpenCode V2 plugin API only. Delivery is bounded, deduplicated per session and phase, fail-open, and never changes a tool result or permission. Deterministic mechanism tests cover all three carriers. [Claude Code live evidence](../benchmarks/results/live-host/claude-2026-11-21-ledger-lesson/README.md) (2.1.330, one run) shows both contexts in the model request that follows the commit, so the action lesson arrives after the first attempt. Codex and OpenCode live receipt remain `UNCHECKED`.

## Current capability summary

| Platform surface | Standalone skills | Plugin support | Hooks/lifecycle | Project scope | Global scope | Current evidence boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `Supported` | `Mechanism verified` | `Partial`: user-hook compatibility capture is live-verified for `UserPromptSubmit` and `Stop` on one Windows Codex CLI host; native plugin hooks remain mechanism-verified | `.agents/skills/`, `AGENTS.md` | `~/.agents/skills/` | [Live evidence](../benchmarks/results/live-host/codex-2026-10-13/README.md) verifies two consecutive turns on Codex CLI 0.162.1; native plugin mounting, other lifecycle events, and other versions remain unverified. |
| Antigravity (AGY) | `Supported` | `Partial` (`Mechanism verified`; global Desktop App `2.34.0` load and `agy` CLI `1.5.15` `validate`/`list --json` live-verified on macOS, plus `agy` CLI `1.5.16` `validate`/`list --json` on Windows; `validate --strict` fails on 2 multi-host warnings; temp `.agents/plugins/` hook discovery observed via `agy --print`) | `Partial`: `Mechanism verified` for all adapters; Desktop App `2.34.0` + CLI `1.5.15` (macOS) live-verified `SessionStart`, `PreInvocation` dedup, `PreToolUse` (`write_file`/`run_command`), `PostToolUse` edit tracking, and `Stop` (`NO_TOOL_CALL`); Windows Desktop + CLI `1.5.16` (`harness-everything` `1.0.1`) live-verified `SessionStart`, `PreInvocation`, and bounded 1-continuation `Stop`; `PostToolUse` omits `exitCode`/`error` on shell outcomes on macOS `2.34.0`/CLI `1.5.15` and Windows Desktop, so unknown shell outcomes grant no verification credit (`exitCode === 0` required); IDE write tools (`write_to_file`/`replace_file_content`/`multi_replace_file_content`) and live `model_stop` remain mechanism-only | `.agents/plugins/harness-everything/`, `.agents/rules/AGENTS.md` | `~/.gemini/config/plugins/harness-everything/` | [Mechanism evidence](../benchmarks/results/live-host/agy-2026-11-22/README.md) + [macOS partial live-host evidence](../benchmarks/results/live-host/agy-2026-11-23/README.md) + [Windows partial live-host evidence](../benchmarks/results/live-host/agy-2026-11-25/README.md); `/hooks` TUI view, full project-scope `harness-everything` isolation, IDE write tools, live shell `exitCode: 0` verification credit, and live `Stop` `model_stop` remain open in issue #514. |
| ChatGPT / OpenAI Plugin | `Unknown` for a repository-local standalone path | `Mechanism verified` | `Partial`: local Work/Codex hooks are separate from ordinary Chat | Managed workspace marketplace | Not established | The public Skills-only bundle is mechanically reproducible; import, approval, and live behavior remain `Unknown`. |
| Claude Code | `Supported` | `Supported` | `Mechanism verified` for Harness configuration | `.claude/skills/` | `~/.claude/skills/` | Native Claude surfaces and the state-specific plugin sync command are mechanically checked; fresh-host execution is not preserved here. |
| OpenCode | `Supported` | `Partial` (V2 plugin API only; OpenCode 1.x / V1 unsupported; V2 default-export load verified live on OpenCode 2.1.3 macOS via server-log only, in the 2.1.4 macOS 26.6.2 V2 lifecycle trace and 2.1.4 macOS workspace trace, and in the 2.4.1 macOS 26.7.3 long-lived server runs; full router injection trace remains mechanism-tested on V2) | `Partial` (V2 default-export load, V2 tool hooks, V2 event envelope + `session.execution.succeeded`, and completion → verification → reminder delivery on a long-lived server are live-observed on OpenCode 2.1.4 macOS 26.6.2; observation recording + training export — with router/context injection indirectly observed as the model emitted the injected label contract — and mid-turn live steering delivery shape are live-observed on OpenCode 2.4.1 macOS 26.7.3 on a long-lived server; full router/context injection trace, ledger lessons, session create/delete reset, and cancellation remain mechanism-verified only; retained 1.18.31 project-scope `.js` loading and edit/verification state artifact is historical/unsupported V1 evidence) | `.opencode/skills/`, `.agents/skills/`, `.opencode/plugins/` | `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.config/opencode/plugins/` | **V2-only support boundary (#453):** OpenCode V2 plugin API family only (OpenCode 1.x / V1 unsupported; no validated minimum patch version claimed). Tested V2 live observations: an isolated [OpenCode 2.1.4/macOS 26.6.2 V2 lifecycle trace](../benchmarks/results/live-host/opencode-2026-11-24-v2-lifecycle/README.md) (one host/version/run establishing V2 default-export load, V2 tool hooks, V2 event envelope + `session.execution.succeeded` completion, and completion → verification → reminder delivery on a long-lived server; `opencode run --standalone` exits before verification finishes), V2 default-export load on OpenCode 2.1.3 (macOS, 2026-10-23, server-log evidence only), a separate [OpenCode 2.1.4/macOS session workspace trace](../benchmarks/results/live-host/opencode-2026-11-15-workspace/README.md) observing `ctx.session.get({sessionID})` returning `location.directory` for two sessions matching setup (no mismatch test or V2 hook fire), and two isolated OpenCode 2.4.1/macOS 26.7.3 long-lived server runs (`OPENCODE_PASSWORD` required): [turn → export trace](../benchmarks/results/live-host/opencode-2026-11-28-397-turn-export/README.md) (observation recording for two turns + idempotent training export; router/context injection indirectly observed as the model emitted the injected label contract, not a full injection trace) and [steering trace](../benchmarks/results/live-host/opencode-2026-11-28-450-steering-trace/README.md) (mid-turn live steering delivery shape, witness-only for #450). Full router/context injection trace, ledger lessons, session create/delete reset, cancellation, and workspace mismatch handling remain mechanism evidence only. [Retained historical/unsupported V1 evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md) (OpenCode 1.18.31, macOS) documents project-scope `.js` loading and edit/verification state in one V1 host session, with a post-reset final snapshot, hard lock only an interactive observation with no retained blocked-tool trace, and operator-seeded then agent-rewritten reflection; it is preserved as historical/unsupported evidence only and does not establish current V2 support. `.mjs` auto-discovery is silently ignored (issue #127); global scope, npm-package installation, and other host versions remain unverified (as do other OSes). |
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
| Antigravity (AGY) | `.agents/plugins/harness-everything/` | `~/.gemini/config/plugins/harness-everything/` | Native Customization System plugin path and lifecycle hooks |
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

By default, update and uninstall remove only exact entries recorded in the Harness compatibility manifest. If an installed Harness entry was edited after installation, restore it before retrying. These operations preserve other user hooks.

For #457, `harness codex-hooks status` lists candidate `legacyTierRouterHooks` in the Codex user hooks file, even before compatibility hooks are installed. After reviewing the list, run `harness codex-hooks install --remove-legacy-tier-router` to remove direct Node invocations of the npx-cached Harness `tier-router.js` from `UserPromptSubmit` and install or refresh the JSON adapter in the same operation. Other handlers in the same hook group are preserved. Ordinary installs and automatic plugin sync preserve these unmanaged entries. Review the resulting hook sources and trust in Codex with `/hooks`.

The compatibility path registers hook commands in Codex user configuration and covers the missing plugin-mount route where user hooks dispatch. It does not repair a Codex carrier that fails to dispatch `PreToolUse` at all; those host-level execution-path limitations remain a live compatibility boundary.

The public OpenAI Skills-only plugin is narrower again. Its ZIP contains the packaged `skills/` tree and referenced files, but not the local `.codex-plugin` lifecycle hooks. Public submission readiness is therefore a package/form contract, not evidence of public-directory approval or live hook execution.

### Codex prompt pass-through and authorization (mechanism only)

Codex `UserPromptSubmit` prompts pass through to the normal router unchanged;
Harness does not parse or intercept a fixed approval syntax. Native agent
task-scope authorization and native permissions remain authoritative. Routine
exact `create_pull_request` operations and Codex title/body-only
`update_pull_request` operations are host-deferred at the mechanism level:
their descriptor remains a mutation (not read/safe), and no Harness consent or
`permissionDecision` is emitted. All other risky actions remain hard PreToolUse
blocks; an explicitly required `actionGate` hint still gates. These are
deterministic mechanism changes, not live-host proof. Codex ask-style decisions
are not supported.

## Install/uninstall ownership boundary

The general installer merges shared files only through Harness-owned markers and removes only manifest-tracked artifacts. Malformed configuration and pre-existing user-owned files fail closed. Install/uninstall round-trip coverage protects user skills and runs on Linux, Windows, and macOS fixtures.

## OpenCode boundary

Harness supports the **OpenCode V2 plugin API only**; OpenCode 1.x / V1 is
unsupported (#453). The plugin module (`opencode-plugin/index.mjs`, installed
under a `.js` filename) default-exports `{ id: "harness.enforcement", setup(ctx) }`
as its only public surface and registers `ctx.session.hook("prompt|context")`,
`ctx.tool.hook("execute.before|after")`, and `ctx.event.subscribe()` through
the OpenCode V2 plugin context, backed by a private internal enforcement core.
No public V1 factory export, V1-only event fallback (such as host
`session.idle` or legacy top-level/nested session-id fallbacks), V1 hook
registration, or compatibility mode is supported; reintroducing V1 support
requires an explicit owner-approved support-contract change. OpenCode V2
rejects named-export-only plugins with `Plugin must export a default definition
with an id and an effect or setup function`.

The supported boundary is the **V2 API family**; exact tested versions are
recorded separately rather than claiming a validated minimum patch version or
coverage of every V2 release:

- **OpenCode 2.1.3 (macOS, 2026-10-23):** server-log load-only evidence showing
  the named-export failure and recovery after switching to the V2 default
  export (no hook-fire artifact).
- **OpenCode 2.1.4 (macOS, 2026-11-15):** a separate [workspace trace](../benchmarks/results/live-host/opencode-2026-11-15-workspace/README.md)
  observing `ctx.session.get({sessionID})` returning `location.directory` for
  two sessions whose directories matched setup; it establishes field
  availability only, not mismatch handling or V2 hook behavior.
- **OpenCode 2.1.4 (macOS 26.6.2, 2026-11-24):** an isolated [V2 lifecycle trace](../benchmarks/results/live-host/opencode-2026-11-24-v2-lifecycle/README.md)
  (one host/version/run on a long-lived `opencode serve` + `opencode run --server`)
  establishing V2 default-export loading, V2 tool hooks (`tool.execute.before/after`),
  the V2 event envelope (`{id, created, type, durable, data}`) and
  `session.execution.succeeded` completion type, and completion → verification →
  reminder delivery. Standalone `opencode run --standalone` shuts down before
  verification finishes. Not exercised in this run: router/context injection,
  observation recording, ledger lessons, session create/delete reset, cancellation,
  global scope, npm-package install, other OpenCode versions, and Windows/Linux.
- **OpenCode 2.4.1 (macOS 26.7.3, 2026-11-28):** two isolated long-lived server
  runs (`opencode serve --hostname 127.0.0.1` + `opencode run --server`; 2.4.1
  requires `OPENCODE_PASSWORD`):
  - [Turn → export trace (#397)](../benchmarks/results/live-host/opencode-2026-11-28-397-turn-export/README.md):
    establishes live observation recording for two consecutive turns in one
    session and idempotent `system-one-cycle` training import/export
    (`persisted: 2` → `persisted: 0, duplicate: 2`, identical export IDs,
    `acceptanceRate: 1`). Router/context injection was indirectly observed
    (model emitted the injected label contract), not a full injection trace.
  - [Steering trace (#450)](../benchmarks/results/live-host/opencode-2026-11-28-450-steering-trace/README.md):
    establishes mid-turn live steering delivery shape (`prompt` +
    `session.inbox.enqueued` + `session.inbox.delivered`, steered message in the
    next `context` of the same execution, no new `session.execution.started`, one
    `session.execution.succeeded` covering both prompts; sequential post-settle
    control receives its own `execution.started` + `succeeded`). Witness-only for
    #450 observation overwrite/drop; no product fix this round.

These observations establish bounded V2 lifecycle coverage on macOS,
not full V2 lifecycle verification across all hooks or platforms. The adapter
has deterministic V2 mechanism coverage (`ci/mechanism-2n-opencode-plugin.test.js`,
V2 edit/verification/reminder/state shapes;
`ci/mechanism-2p-opencode-v2-entrypoint.test.js`, V2-only export contract and
lifecycle shapes; `ci/mechanism-397-opencode-observations.test.js`, router
injection, fail-open router diagnostics on launch or runtime failure, turn
capture, malformed-label export counts, and opt-out). Full router/context
injection trace, ledger lessons, session create/delete reset, cancellation,
and workspace mismatch handling remain mechanism evidence only; global scope,
npm-package install, and other versions/OSes remain unverified.

**Historical / unsupported V1 evidence:** retained evidence from the retired V1
era documents project-scope `.js` loading and edit/verification state on
OpenCode 1.18.31 (macOS): [live-host evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md).
That snapshot predates #190 and #453 and is preserved as historical/unsupported
evidence only — never promote it to current V2 capability evidence. Its final
snapshot is post-reset, the old hard lock was only an interactive observation
with no retained blocked-tool trace, and the old reflection was operator-seeded
then agent-rewritten (so it proves no behavioral effect). The forced Rule-of-3
reflection gate has since been retired; current package and mechanism checks
cover that retirement, with no post-retirement live-host run preserved. `.mjs`
auto-discovery is silently ignored (issue #127). Global scope, npm-package
installation, and other OpenCode versions remain unverified.

The plugin verification runner uses asynchronous child processes with a shared
sequence budget and bounded streamed diagnostics. Deterministic mechanism
coverage checks event-loop responsiveness, large-output verdicts, timeout/process
cleanup, and concurrent edit/session reset handling. The standalone manual CLI
retains its synchronous per-command runner. This change supplies no additional
live-host evidence; the historical installation and behavior boundaries above
remain unchanged.

## Official sources

The matrix records the official documentation reviewed for each platform. Important source families include [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenAI public submission](https://developers.openai.com/plugins/deploy/submission), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude skills](https://code.claude.com/docs/en/skills), [OpenCode skills](https://opencode.ai/docs/skills), [OpenCode plugin hooks](https://opencode.ai/docs/build/plugins/server/), [OpenCode V1 plugin migration](https://opencode.ai/docs/build/plugins/migrate-v1/), [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Cursor skills](https://cursor.com/docs/skills), [Continue rules](https://docs.continue.dev/customize/rules), and [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

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

**Historical (retired E1 pilot):** credited reconciliation for F4 (Claude Code only, pilot ON) was **implemented, with mechanism and package evidence and one live field-availability capture**. Credit works for `doc-lint` and `link-check` through a registered `doc-check` run, and for an independent `quality-review` with bound path digests. The capture under `benchmarks/results/live-host/claude-325-3b-s2b/` proves field availability on Claude Code 2.1.308 for one session. It is not live-host credit, and no live-host credit run exists yet. Deterministic mechanism tests (replay through the real hook entry points, with a CI-only qualification preloader) prove the chain.

**Historical (retired E1 pilot):** PR-B added a dedicated `outline-confirmation` evidence lane for Claude captures with separate B/O/D checks, a coordinator-sealed pre-dispatch handoff, pinned-inventory row binding, and an independent exact-O review. A separate sanitized capture qualified the **observed Claude Code 2.1.312 run8 profile**, recorded at main baseline `1bd0f805031c5577a6e7f72a9bc5b41618b71fc1`. This remains retained field-mapping evidence, not runtime version enforcement or an E1 qualifying cycle. OpenCode, Codex and other Claude Code versions received no outline qualification. Missing or ambiguous capture stayed unresolved and host tools remained fail-open. The outline result did not replace the aggregate B→D MUST result or the existing exact-D `quality-review` contract.

**Historical (retired E1 pilot):** W3/W6 added only the closed workflow-state operations named in [the reconciliation contract](doc-workflow-reconciliation.md#writer-policy-phase-aware): plan/start and inventory before O, one seal after the approved O review, then three ordered dispositions after worker closure and final review. The installed producer exposed only `inventory` and `seal`, which have since been removed under #553 (see below); previously, the real Pre/Post hook journal and provider validated invocation identity, phase, exact destinations, schema and transition, and `state-persist` used that same decision so verified state-only calls did not appear as task edits or verification evidence. The outline mechanism suite exercised source and packaged paths; this is deterministic mechanism/package evidence only. No live W6 host cycle or E1 qualification is claimed.

### E1 pilot retirement and retained document controls (#553)

The E1 reconciliation pilot is retired, and its runtime modules and W6 `inventory`/`seal` CLI
(`hooks/scripts/w6-state-operations.js`) have been removed (#553). Under the retirement contract
every `HARNESS_DOC_RECONCILIATION_PILOT` value is ignored, ordinary hooks print no flag warning,
and workflow credit and Stop no longer load the E1 provider (#553); generic verification, required
bindings and Fable correlation are unchanged, and a legacy doc-only verification no longer
satisfies Stop. In-flight E1 work belongs to the previous release; after upgrading, end the old
session and open a new one to redo review/verify. Recorded journals, reports and outline artifacts
stay in place. Issues
[#325](https://github.com/dyphn1/Harness-everything/issues/325) and
[#350](https://github.com/dyphn1/Harness-everything/issues/350) remain open failure markers.

The document controls below remain available and are unchanged by this retirement. Each is
package/mechanism evidence only, grants no E1 credit and makes no live-host claim:

- `doc-check` editorial check (F1, `harness-everything/scripts/doc-check.js`): instruction-only,
  no `doc-change` step binding, no host enforcement and no Stop lock; a non-empty
  `coverage.unsupported` marks it partial.
- `compare-derived` (F3): byte-for-byte comparison of a caller-captured generator output with a
  declared derived view; runs no generator and writes no files. The generation status is
  caller-reported.
- `doc-check check --conflict-assessment`: full governed/legacy corpus conflict check that
  requires `--base` as an exact commit SHA; accepts recorded and structural conflicts only,
  leaves prose contradictions to independent `quality-review`, and remains refused on OpenCode.
- `doc-governance` CI guard (PR #376): on `pull_request` it extracts
  `scripts/doc-governance-guard.js` from the event base and runs those bytes against the exact
  base/head SHAs, never the candidate copy; nonzero exits fail that job independently of the other
  CI jobs. Its trust-surface and decision classes are unchanged.

### Own-repository governance guard (PR #376)

On `pull_request`, a standalone `doc-governance` job extracts `scripts/doc-governance-guard.js` from the event base commit and runs those bytes against the exact event base/head SHAs. Its nonzero result fails that job; `self-regression` and the other CI jobs run independently. The ordinary test suite may still run on GitHub's PR checkout SHA, which can be a synthetic merge commit; it is reported separately. The guard never falls back to the candidate copy. PR #376's reviewed base lacked the verifier; that historical bootstrap reported BOOTSTRAP_UNCHECKED without executing candidate bytes. Bases containing the guard (including main at 0ef0541c) execute the base-owned verifier. If a selected PR base lacks the guard, the wrapper retains the warning/step-summary-only bootstrap path with exit 0; this is unverified governance, not PASS. Every nonzero exit from an extracted verifier, including FAIL and BOOTSTRAP_UNCHECKED, fails the governance job. Other CI jobs run independently.

The guard's trust surface includes every Git entry under `ci/fixtures/doc-lifecycle/scenarios/`, compared by raw Git identity (`mode`, `type`, `oid`). A regular governed-content revision with the same mode returns `PASS` as an informational `revised` entry with both Git identities; the guard does not semantically validate revised content. Deletion/rename, mode/type, policy/config or new-member registration, trust-surface/fixture, and derived-output changes still return `REVIEW_REQUIRED`. Derived changes retain their regeneration/parity evidence requirement. Ordinary ungoverned edits and new unknown documents remain allowed as `PASS`, with unknown content validation visible.

This integration lives in candidate-controlled `.github/workflows/ci.yml` and can be removed by a candidate change. The independent review found the prior fixture-oracle gap; re-review of the fixed guard at final exact SHAs is pending. No external required-status check is enabled, and no live-host evidence is established. This is package and mechanism evidence only; it does not qualify E1. E1 remains at zero qualifying cycles and owner GO is not issued.
