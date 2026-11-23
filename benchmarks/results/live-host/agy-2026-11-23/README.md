# Live-Host Evidence: Google Antigravity (AGY) 2.34.0 (macOS, Partial)

Sanitized live-host verification of the native Google Antigravity (AGY) plugin and lifecycle hooks on Antigravity 2.0 Desktop App. This establishes **partial** live-host coverage (global Desktop App scope on macOS) and records observed host limitations explicitly; remaining surfaces (`agy` CLI, IDE-specific write tools, and `PostToolUse` shell failure capture) stay open in Issue #514.

## Environment & Scope

| Field | Value |
|---|---|
| Date | 2026-11-23 |
| Host | Antigravity 2.0 Desktop App `2.34.0` (Language Server `hub-2.34.0`) |
| OS / Runtime | macOS `26.6.2` (Build `25G83`), Node `v24.22.1` |
| Install Scope | Global: `<HOME>/.gemini/config/plugins/harness-everything` |
| Sync Operation | `node scripts/plugin-sync.js --host agy --json` → `status: "synchronized"`, `action: "update"` |
| Branch / Package | `feat/510-agy-plugin` (PR #513), package version `0.57.4` |
| `agy` CLI | Not installed on this host (`agy plugin validate` remains `UNCHECKED`) |

## Live Observations

| Surface | Result | Sanitized Evidence |
|---|---|---|
| Plugin load & discovery | **Observed live** | `GetAllPlugins` RPC returned `name: "harness-everything"`, `disabled: false`, `isGlobal: true`, `skillCount: 28`, `rules: [".../rules/AGENTS.md"]`, `hasHooksJson: true` (`hooksJsonLen: 1037`). |
| `SessionStart` | **Observed live** | Injected `Harness Skills OS active. Operating under AGENTS.md invariant-first routing.` at step 1 of a user-initiated AGY conversation (`<conv-id>`). |
| `PreInvocation` | **Observed live** | Injected `[Tier Routing Pre-check]` and persisted `workflow-run.json` keyed by `conversationId`. Before the per-turn dedup fix it repeated on every model call; after syncing the fixed `agy-pre-invocation.js`, mid-turn repeated injections stopped completely. |
| `PreToolUse` (`write_file` allow) | **Observed live** | `write_file` inside `artifactDirectoryPath` (`<appData>/brain/<conv-id>/.system_generated/swarm/plan.json`) was denied prior to the fix and **ALLOWED** (`Created file.`) after syncing. |
| `PreToolUse` (`write_file` deny) | **Observed live** | `write_file` outside workspace (`/tmp/agy-live-oob-probe.txt`) **DENIED** by AGY: `tool call denied by pre-tool hook: Harness boundary guard: modification outside workspace root is forbidden (/tmp/agy-live-oob-probe.txt).` |
| `PreToolUse` (`run_command` allow) | **Observed live** | Safe command `echo agy-live-allow-ok` **ALLOWED** (exit 0). |
| `PreToolUse` (`run_command` deny) | **Observed live** | Destructive command `git -C /tmp/nonexistent-agy-probe push --force origin main` **DENIED** via canonical Action Gate: `tool call denied by pre-tool hook: [Harness actionGate:git-force-push] Force-pushing can rewrite remote history.` |
| `PostToolUse` (edit/verify state) | **Observed live (partial)** | Fired live and persisted `handoff-state.json` timestamps (`lastEditAt`: `1795394108668` → `1795394132329`; after passing `npm run test:portability`, `lastVerifyAt: 1795394172552` ≥ `lastEditAt: 1795394172544`, `lastVerifyExitCode: null`). |
| `PostToolUse` (shell non-zero exit) | **Host-limited / Unverified** | On `node -e "process.exit(1)"` (exit code 1), AGY `2.34.0` `PostToolUse` omitted both `exitCode` and `error`, leaving `handoff-state.json` at `status: "idle"` rather than `"failed"`. |
| `Stop` (Verify-Before-Claim) | **Observed live** | Blocked termination when `lastEditAt > lastVerifyAt` (`Stop hook blocked termination: Harness Verify-Before-Claim: unverified edits exist in session.`), and allowed clean termination (`{}`) after `npm run test:portability` updated `lastVerifyAt >= lastEditAt`. |

## Explicit Evidence Boundaries

- **Global Desktop App scope only**: Only `<HOME>/.gemini/config/plugins/harness-everything` on Antigravity 2.0 Desktop App `2.34.0` (macOS) was exercised. Project-scope `.agents/plugins/harness-everything/`, Windows/Linux hosts, and other AGY versions remain `UNCHECKED`.
- **`agy` CLI**: Not installed on this host; `agy plugin validate` remains `UNCHECKED` (tracked in Issue #514).
- **IDE write tools**: Desktop App `2.34.0` exposes `write_file`, `edit_file`, and `run_command`. IDE-specific tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) remain **mechanism verified** only (`ci/mechanism-agy-hooks.test.js`), not live-exercised here.
- **`PostToolUse` shell failure capture**: Observed as **host-limited** on AGY `2.34.0` because non-zero shell commands did not populate `error` or `exitCode` in the `PostToolUse` payload; do not claim live shell-failure state tracking on AGY `2.34.0`.
- **`Stop` continuation/termination paths**: On AGY `2.34.0`, `Stop` re-blocked until verification cleared `lastEditAt`. `continuationActive`, `stop_hook_active`, and non-`NO_TOOL_CALL` `terminationReason` bypasses remain verified by deterministic mechanism tests (`ci/mechanism-agy-hooks.test.js`).
- **Companion mechanism record**: See [agy-2026-11-22](../agy-2026-11-22/README.md) for package and deterministic mechanism verification.
