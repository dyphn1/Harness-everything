# Live-Host Evidence: Google Antigravity (AGY) Plugin & Lifecycle Hooks

This records the live host architecture and deterministic verification of the native Google Antigravity (AGY) plugin and lifecycle hook integration on macOS.

- Date: 2026-11-22
- Host: Google Antigravity (AGY) IDE / CLI runtime; macOS Darwin x64; Node.js v24.22.1
- Repository branch under test: `feat/510-agy-plugin` (Issue #510)
- Packaged plugin: `plugins/harness-everything/` (version 0.57.2)
- Manifest targets: `.antigravity-plugin/plugin.json`, `rules/AGENTS.md`, and root `hooks.json`

## Verified Capabilities

### 1. Packaging & Manifest Lockstep (Phase 1)
- Manifest: `plugins/harness-everything/.antigravity-plugin/plugin.json` strictly conforms to the AGY Customization System specification (`name`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`).
- Rules Integration: `plugins/harness-everything/rules/AGENTS.md` is synchronized from the repository root `AGENTS.md` byte-for-byte.
- Canonical Skills: All 28 canonical skills are present in `plugins/harness-everything/skills/` with valid frontmatter and token count $\le 500$.
- Verified by: `npm run test:plugin:agy` (`ci/agy-plugin-package.test.js`).

### 2. Lifecycle Hook Enforcement (Phase 2)
The AGY plugin provides native lifecycle adapters communicating over `stdin`/`stdout` using the AGY protojson camelCase format:
- `PreInvocation` (`agy-pre-invocation.js`): Injects Kernel Router invariant advice and ledger lessons into the conversation via `injectSteps`.
- `PreToolUse` (`agy-pre-tool.js`): Intercepts `run_command`, `write_file`, and `edit_file`:
  - Enforces workspace containment (denies writes to `/etc/shadow` or out-of-bounds paths).
  - Enforces destructive command rejection (`rm -rf /` and `git push --force origin main` denied).
- `PostToolUse` (`agy-post-tool.js`): Captures exit codes and errors for state persistence.
- `Stop` (`agy-stop.js`): Implements Verify-Before-Claim, returning `{"decision": "continue"}` when completion is claimed without test verification, while respecting `continuationActive` to prevent infinite loops.
- `SessionStart` (`agy-session-start.js`): Bootstraps session state and displays active Harness OS banner.
- Verified by: `npm run test:plugin:agy` (`ci/agy-hooks.test.js`).

### 3. Automated Synchronization & CLI (Phase 3)
- `scripts/plugin-sync.sh` and `scripts/plugin-sync.js` support `--host agy` (and `--host all`):
  - Detects AGY environment via CLI presence (`agy`) or customization directory roots (`.agents/` or `~/.gemini/`).
  - Implements state-based branching: installs if absent; performs atomic update/refresh if already installed.
  - Supports `--dry-run` and `--json` machine-readable output.
- Verified by: `npm run test:plugin:hosts` (`ci/mechanism-2ao-plugin-sync.test.js`).

## Repository Verification Summary

| Gate | Command | Result |
|---|---|---|
| AGY Plugin Package & Hooks | `npm run test:plugin:agy` | PASS |
| Host Plugin Synchronization | `npm run test:plugin:hosts` | PASS |
| Consistency & Contract | `npm run test:consistency` | PASS |
| Release Lockstep | `npm run test:release` | PASS |
| OpenAI Plugin Package | `npm run test:plugin:openai` | PASS |
| Documentation Sync | `npm run docs:sync` | PASS |
