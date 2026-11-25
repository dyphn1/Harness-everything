# Live-Host Evidence: Google Antigravity (AGY) Windows Desktop & CLI 1.5.16 (Partial)

Sanitized live-host verification of the native Google Antigravity (AGY) plugin (`harness-everything` `1.0.1`, matching commit `d5789004` / PR #521) on **Windows**. This records partial live-host coverage on Windows Desktop App and `agy` CLI `1.5.16`, confirms that PR #521's bounded `Stop` continuation fix operates on live Windows sessions, and documents the remaining #516 / #514 gaps observed during the run.

## Environment & Scope

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Host | Antigravity Desktop App (Windows) + `agy` CLI `1.5.16` |
| OS / Runtime | Windows, Node `v24.18.0` |
| Install Scope | Global: `<USERPROFILE>/.gemini/config/plugins/harness-everything` (`version: 1.0.1`, updated `2026-11-25 08:52`, SHA-256 parity verified against `plugins/harness-everything` at `d5789004`) |
| Related Issues | #516 (Windows Stop loop / verification detection), #514 (AGY live-host evidence), #510 |

## Live Observations (Windows Desktop App & `agy` CLI `1.5.16`)

| Surface | Result | Sanitized Evidence |
|---|---|---|
| `agy --version` / `agy plugin list --json` | **Observed live** | `agy` CLI `1.5.16` listed `<USERPROFILE>/.gemini/config/plugins/harness-everything` (`enabled: true`, `version: "1.0.1"`, 28 skills, `rules: ["AGENTS.md"]`, `hooks: ["harness-everything"]`). |
| `agy plugin validate --json ./plugins/harness-everything` | **Observed live** | Exited `0` (`manifest: ".antigravity-plugin/plugin.json"`, `components: { agents: 0, hooks: 1, mcpServers: 0, rules: 1, sidecars: 0, skills: 28 }`, 2 expected multi-host warnings + 1 note). |
| `SessionStart` | **Observed live** | Injected `Harness Skills OS active. Operating under AGENTS.md invariant-first routing.` at step 1 of live Windows Desktop session `<conv-2>`. |
| `PreInvocation` | **Observed live** | Injected `[Tier Routing Pre-check]` and persisted `workflow-run.json` and `agy-pre-invocation-state.json` under `<USERPROFILE>/.agents/harness-everything/workspaces/<ws-key>/state/sessions/<conv-id>/`. |
| `Stop` bounded continuation (with direct edits) | **Observed live** | In live Windows Desktop session `<conv-1>` (`developerdocs`, `2026-11-25 10:13–10:16`), `handoff-state.json` tracked `agyDirectMutationRevision: 5`, and `agy-stop-state.json` recorded `lastContinuedRevision: "direct:5"` with `lastContinuedContentFingerprint`, bounding continuation to 1 and allowing subsequent build + commit completion without the prior 7+ turn loop. |
| `Stop` bounded continuation (read-only PowerShell session) | **Observed live** | In live Windows Desktop session `<conv-2>` (`Harness-everything`, `2026-11-25 17:28–17:32`) with zero workspace file edits, running PowerShell pipelines (`Get-ChildItem ... \| ForEach-Object { ... }`) and `npm.cmd run test:consistency` updated `handoff-state.json` `lastEditAt`. At turn end (`2026-11-25T09:32:21.322Z`), host `Stop` returned `continue` once and wrote `agy-stop-state.json` (`lastContinuedRevision: "session:<conv-2>"` + `lastContinuedContentFingerprint`), then allowed termination on the following turn end with unchanged workspace content. |
| `PostToolUse` shell verification credit | **Host-limited / Gap confirmed** | On both `<conv-1>` (`.venv\Scripts\mkdocs build --strict`) and `<conv-2>` (`npm.cmd run test:consistency`, `node --test ...`), `lastVerifyAt` remained unset: (1) live Desktop `PostToolUse` omitted numeric `exitCode`, and (2) `verification-contract.js` did not recognize `mkdocs`, `.venv\Scripts\mkdocs`, `npm.cmd`, or `node --test`. |
| Installed hook scripts (isolated `HARNESS_STATE_HOME`) | **Mechanism verified** | Direct invocation of all 5 installed scripts under `<USERPROFILE>/.gemini/config/plugins/harness-everything/hooks/scripts/agy-*.js` passed (`SessionStart`, `PreInvocation` dedup, `PreToolUse` in/out-of-bounds + `git push --force` deny, `PostToolUse`, and `Stop` 1-continuation cap under PowerShell command churn). |

## Observed Remaining Gaps (Analysis Input for #516 Follow-up)

1. **PowerShell read-only pipelines / `npm.cmd` bump `lastEditAt`:** `workflow-isolation.js` (`splitShellSegments` / `READ_ONLY_PREFIX_RE`) marks PowerShell script blocks (`{...}`) and `$` expressions (`$_.Name`) as `untrusted`, and `npm.cmd` as `mutation-or-unknown`, causing `state-persist.js` to advance `lastEditAt` on read-only turns.
2. **Windows verification command recognition:** `scripts/lib/verification-contract.js` did not match Windows `.cmd` runner wrappers (`npm.cmd`, `pnpm.cmd`, `yarn.cmd`, `bun.cmd`), `node --test`, `mkdocs build`, `poetry run mkdocs build`, or `Set-Location ...; <cmd>` PowerShell preludes.
3. **Unresolved host / #514 items:** Live `PostToolUse` `exitCode: 0` emission on AGY Desktop, IDE-specific write tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`), live `model_stop`, project-scope `.agents/plugins/harness-everything/` isolation without global install, and `/hooks` TUI view remain `UNCHECKED`.
