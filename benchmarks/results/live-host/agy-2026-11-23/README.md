# Live-Host Evidence: Google Antigravity (AGY) 2.34.0 & CLI 1.5.15 (macOS, Partial)

Sanitized live-host verification of the native Google Antigravity (AGY) plugin and lifecycle hooks on Antigravity 2.0 Desktop App `2.34.0` and `agy` CLI `1.5.15`. This establishes **partial** live-host coverage on macOS and records observed host limitations explicitly; remaining surfaces (`/hooks` TUI view, full project-scope `harness-everything` isolation, IDE-specific write tools, live `PostToolUse` shell `exitCode: 0` verification credit, and live `Stop` `model_stop`) stay open in Issue #514.

## Environment & Scope

| Field | Value |
|---|---|
| Date | 2026-11-23 |
| Host | Antigravity 2.0 Desktop App `2.34.0` (Language Server `hub-2.34.0`) + `agy` CLI `1.5.15` |
| OS / Runtime | macOS `26.6.2` (Build `25G83`), Node `v24.22.1` |
| Install Scope | Global: `<HOME>/.gemini/config/plugins/harness-everything` (plus temp project-scope `.agents/plugins/` hook probe via `agy --print`) |
| Sync Operation | `node scripts/plugin-sync.js --host agy --json` → `status: "synchronized"`, `action: "update"` |
| Branch / Package | `feat/510-agy-plugin` (PR #513), package version `0.57.4` |

## Live Observations (Desktop App `2.34.0`)

| Surface | Result | Sanitized Evidence |
|---|---|---|
| Plugin load & discovery | **Observed live** | `GetAllPlugins` RPC returned `name: "harness-everything"`, `disabled: false`, `isGlobal: true`, `skillCount: 28`, `rules: [".../rules/AGENTS.md"]`, `hasHooksJson: true` (`hooksJsonLen: 1037`). |
| `SessionStart` | **Observed live** | Injected `Harness Skills OS active. Operating under AGENTS.md invariant-first routing.` at step 1 of a user-initiated AGY conversation (`<conv-id>`). |
| `PreInvocation` | **Observed live** | Injected `[Tier Routing Pre-check]` and persisted `workflow-run.json` keyed by `conversationId`. Before the per-turn dedup fix it repeated on every model call; after syncing the fixed `agy-pre-invocation.js`, mid-turn repeated injections stopped completely. |
| `PreToolUse` (`write_file` allow) | **Observed live** | `write_file` inside `artifactDirectoryPath` (`<appData>/brain/<conv-id>/.system_generated/swarm/plan.json`) was denied prior to the fix and **ALLOWED** (`Created file.`) after syncing. |
| `PreToolUse` (`write_file` deny) | **Observed live** | `write_file` outside workspace (`/tmp/agy-live-oob-probe.txt`) **DENIED** by AGY: `tool call denied by pre-tool hook: Harness boundary guard: modification outside workspace root is forbidden (/tmp/agy-live-oob-probe.txt).` |
| `PreToolUse` (`run_command` allow) | **Observed live** | Safe command `echo agy-live-allow-ok` **ALLOWED** (exit 0). |
| `PreToolUse` (`run_command` deny) | **Observed live** | Destructive command `git -C /tmp/nonexistent-agy-probe push --force origin main` **DENIED** via canonical Action Gate: `tool call denied by pre-tool hook: [Harness actionGate:git-force-push] Force-pushing can rewrite remote history.` |
| `PostToolUse` (edit state & shell outcome) | **Observed live (partial)** | Fired live and persisted `handoff-state.json` edit timestamps (`lastEditAt`: `1795394108668` → `1795394132329`). Prior to the P1-B `--agy` fix, running `npm run test:portability` with omitted `exitCode` and absent `error` inferred success (`lastVerifyAt: 1795394172552`, `lastVerifyExitCode: null`). After P1-B, omitted `exitCode`/`error` is treated as `unknown` (`host-limited / UNCHECKED` for live shell verification credit; explicit `exitCode === 0` is required to advance `lastVerifyAt` or clear `failed`). |
| `PostToolUse` (shell non-zero exit) | **Host-limited / Unverified** | On `node -e "process.exit(1)"` (exit code 1), AGY `2.34.0` `PostToolUse` omitted both `exitCode` and `error`, leaving `handoff-state.json` at `status: "idle"` rather than `"failed"`. |
| `Stop` (Verify-Before-Claim) | **Observed live (partial)** | On `2.34.0`, blocked termination when `lastEditAt > lastVerifyAt` (`Stop hook blocked termination: Harness Verify-Before-Claim: unverified edits exist in session.`), and allowed clean termination once `lastVerifyAt >= lastEditAt`. After P1-A/P2 fixes, allowed `Stop` returns `{"decision":"allow"}` (previously `{}` during the `2.34.0` run), and `model_stop` evaluates `handoff-state.json` rather than bypassing (mechanism-verified; live `model_stop` remains `UNCHECKED`). |

## Live Observations (`agy` CLI `1.5.15`)

| Surface | Result | Sanitized Evidence |
|---|---|---|
| `agy --version` | **Observed live** | `1.5.15` (`<HOME>/.local/bin/agy`). |
| `agy plugin validate --json` | **Observed live** | Exited `0` on `plugins/harness-everything`: `manifest: ".antigravity-plugin/plugin.json"`, `name: "harness-everything"`, `agentPluginsSpec: false`, `components: { agents: 0, hooks: 1, mcpServers: 0, rules: 1, sidecars: 0, skills: 28 }`. Reported 2 multi-host warnings (`hooks/hooks.json` never loaded; `plugin.json` ignored because `.antigravity-plugin/plugin.json` takes precedence) + 1 note (`no logo`). |
| `agy plugin validate --strict --json` | **Observed live** | Exited `1` (`Error: validation failed in strict mode: 2 warnings`) due to the 2 multi-host packaging warnings above. |
| `agy plugin list --json` | **Observed live** | Listed global `<HOME>/.gemini/config/plugins/harness-everything` (`enabled: true`, `version: "0.57.4"`, 28 skills, `rules: ["AGENTS.md"]`, `hooks: ["harness-everything"]`). In a temporary project directory with candidate plugin roots (`.agents/plugins/`, `.antigravity/plugins/`, `.gemini/plugins/`, `.gemini/config/plugins/`, `.claude/plugins/`), `agy plugin list --json` reported global-only plugins. |
| Project-scope `.agents/plugins/` hook discovery (`agy --print`) | **Observed live (probe)** | Running `agy --print` in a temporary workspace (`/tmp/agy-hook-probe`) with a temporary project-scope `.agents/plugins/probe-hooks/` plugin discovered and loaded project-scope `hooks.json` (`hooks_manager.go:54] loaded 2 named hooks from 2 hooks.json file(s)`) and executed all 5 lifecycle hooks (`SessionStart`, `PreInvocation`, `PreToolUse`, `PostToolUse`, `Stop`). |
| CLI `PostToolUse` shell exit-1 & write dispatch | **Host-limited / Observed live** | In the live `agy --print` session, `run_command` (`node -e "process.exit(1)"`) printed `Command exited with code 1.` in stream output, **but** `PostToolUse` stdin payload had `"error": ""` with no `exitCode` and no `toolResponse` (confirming the `2.34.0` shell-outcome omission on CLI `1.5.15`). Even when prompted for `write_to_file`, CLI dispatched `toolCall.name: "write_file"` (`args: { Content, Overwrite, Path }`). `Stop` payload carried `continuationActive: false`, `executionNum: 0` (then `1`), `fullyIdle: true`, `terminationReason: "NO_TOOL_CALL"`, `error: ""`. |

## Explicit Evidence Boundaries

- **Global scope vs. project scope**: Full `harness-everything` execution is live-verified only in `<HOME>/.gemini/config/plugins/harness-everything` on Desktop App `2.34.0` and `agy` CLI `1.5.15` (macOS). Temporary `.agents/plugins/` hook discovery is live-verified via `probe-hooks` on `agy --print`, while full project-scope `harness-everything` isolation without global install, Desktop App project scope, `/hooks` TUI inspection, and Windows/Linux hosts remain `UNCHECKED` (Issue #514).
- **IDE write tools**: Both Desktop App `2.34.0` and CLI `1.5.15` dispatched `write_file` (even when prompted for `write_to_file`). IDE-specific tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) remain **mechanism verified** only (`ci/mechanism-agy-hooks.test.js`), `host-limited / UNCHECKED` live.
- **`PostToolUse` shell outcome & verification credit**: Observed as **host-limited** on both Desktop `2.34.0` and CLI `1.5.15` because non-zero shell commands (`exit 1`) omitted `error` and `exitCode` in `PostToolUse`. After P1-B, unknown shell outcomes grant no verification credit and preserve any `failed` state; live shell `exitCode: 0` verification credit remains `UNCHECKED`. (`lastVerifyExitCode: null` in the earlier `2.34.0` capture was inferred from absent `error` before P1-B and is now `host-limited / UNCHECKED`.)
- **`Stop` continuation/termination paths**: Live runs observed `NO_TOOL_CALL`, `fullyIdle: true`, and `executionNum: 0/1`. `agy-stop.js` returns `{"decision":"allow"}` on permitted stops, evaluates `model_stop` and empty/normal reasons against `handoff-state.json`, exempts only explicit abnormal `terminationReason` values, and keeps `continuationActive`/`stop_hook_active` as compatibility recursion guards (not official documented Stop input fields). Live `model_stop` execution remains `UNCHECKED` (mechanism-verified in `ci/mechanism-agy-hooks.test.js`).
- **Companion mechanism record**: See [agy-2026-11-22](../agy-2026-11-22/README.md) for package and deterministic mechanism verification.
