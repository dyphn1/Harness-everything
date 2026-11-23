# Evidence: Google Antigravity (AGY) Plugin & Lifecycle Hooks

This records the package architecture and deterministic mechanism verification of the native Google Antigravity (AGY) plugin and lifecycle hook integration on macOS.

- Date: 2026-11-22 (updated 2026-11-23 after sync to `0.57.4`)
- Host: Google Antigravity (AGY) IDE / CLI runtime (mechanism tests under Node.js on macOS; see [agy-2026-11-23](../agy-2026-11-23/README.md) for partial live-host evidence on Antigravity 2.0 Desktop App `2.34.0`, and Issue #514 for remaining unchecked surfaces)
- Repository branch under test: `feat/510-agy-plugin` (Issue #510, PR #513)
- Packaged plugin: `plugins/harness-everything/` (version `0.57.4`)
- Manifest targets: `.antigravity-plugin/plugin.json`, `rules/AGENTS.md`, and root `hooks.json`

## Verified Capabilities (Mechanism Only)

### 1. Packaging & Manifest Lockstep (Phase 1)
- Manifest: `plugins/harness-everything/.antigravity-plugin/plugin.json` conforms to the AGY Customization System specification (`name`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`).
- Rules Integration: `plugins/harness-everything/rules/AGENTS.md` is synchronized from the repository root `AGENTS.md` byte-for-byte.
- Hook Runtime Parity: Packaged `plugins/harness-everything/hooks/scripts/agy-*.js` and `lib/agy-adapter-core.js` match repository `hooks/scripts/` byte-for-byte.
- Canonical Skills: All 28 canonical skills are present in `plugins/harness-everything/skills/` with required `## USE FOR:` / `## DO NOT USE FOR:` routing sections.
- Verified by: `npm test` (`ci/mechanism-agy-plugin-package.test.js`, auto-discovered by `ci/mechanism-test.js`).

### 2. Lifecycle Hook Enforcement (Phase 2 — Mechanism Verified)
The AGY plugin provides lifecycle adapters communicating over `stdin`/`stdout` using the AGY protojson camelCase format:
- `SessionStart` (`agy-session-start.js`): Binds session workspace identity from `conversationId` + `workspacePaths`/`cwd` and injects the active Harness OS banner.
- `PreInvocation` (`agy-pre-invocation.js`): Invokes the Kernel Router once per user turn (deduplicated per turn via session state + `invocationNum` guard), injecting routing context via `injectSteps` and bridging `conversationId` to `workflow-run.json`.
- `PreToolUse` (`agy-pre-tool.js`): Intercepts `run_command`, `write_file`, `edit_file`, `write_to_file`, `replace_file_content`, and `multi_replace_file_content`:
  - Enforces canonicalized (`fs.realpathSync`) filesystem containment across `workspacePaths`, `cwd`, and `artifactDirectoryPath`; denies missing/empty paths and out-of-bounds or symlink-escaped targets.
  - Invokes canonical Action Gate policies (`action-gate.js`) with normalized `args.Cwd` and `toolCall.id` to reject destructive operations, force-pushes, publish, and hard reset.
- `PostToolUse` (`agy-post-tool.js`): Normalizes `run_command` (`Cwd`) and file-write (`file_path`) payloads, captures AGY `error` strings and exit codes into session state (`handoff-state.json`) via `state-persist.js`.
- `Stop` (`agy-stop.js`): Implements Verify-Before-Claim using normalized `conversationId` + `workspacePaths`/`cwd` workspace resolution, returning `{"decision": "continue"}` on unresolved failures or unverified edits while allowing stop on `continuationActive`/`stop_hook_active` and non-`NO_TOOL_CALL` `terminationReason` values.
- Verified by: `npm test` (`ci/mechanism-agy-hooks.test.js`, auto-discovered by `ci/mechanism-test.js`).

### 3. Automated Synchronization & CLI (Phase 3 — Mechanism Verified)
- `scripts/plugin-sync.sh` and `scripts/plugin-sync.js` support `--host agy` (and `--host all`):
  - Under default `--host all`, requires AGY CLI (`agy`) or an existing AGY install (`.antigravity-plugin/plugin.json` under `.agents/plugins/` or `~/.gemini/config/plugins/`), skipping unrelated Codex `.agents/` directories.
  - Supports explicit `--host agy` to install/update and `--dry-run` (reporting `status: "dry-run"` without mutating disk).
  - Performs atomic staged replacement with rollback on failure, cleaning obsolete files and replacing partial/corrupted target directories cleanly.
- Verified by: `npm run test:plugin:hosts` (`ci/mechanism-2ao-plugin-sync.test.js`).

## Repository Verification Summary

| Gate | Command | Result |
|---|---|---|
| Full Local Suite (incl. AGY package, hooks & host sync) | `npm run verify:all` | PASS |
| AGY Plugin Package | `node ci/mechanism-agy-plugin-package.test.js` | PASS |
| AGY Lifecycle Hooks | `node ci/mechanism-agy-hooks.test.js` | PASS |
| Host Plugin Synchronization | `npm run test:plugin:hosts` | PASS |
| Consistency & Contract | `npm run test:consistency` | PASS |
| Release Lockstep | `npm run test:release` | PASS |
| OpenAI Plugin Package | `npm run test:plugin:openai` | PASS |
| Documentation Sync | `npm run docs:sync` | PASS |
