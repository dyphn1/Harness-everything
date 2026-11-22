# Evidence: Google Antigravity (AGY) Plugin & Lifecycle Hooks

This records the package architecture and deterministic mechanism verification of the native Google Antigravity (AGY) plugin and lifecycle hook integration on macOS.

- Date: 2026-11-22
- Host: Google Antigravity (AGY) IDE / CLI runtime (mechanism tests under Node.js on macOS; real-host loading and live IDE/CLI execution remain `Unknown` and are tracked in issue #514)
- Repository branch under test: `feat/510-agy-plugin` (Issue #510, PR #513)
- Packaged plugin: `plugins/harness-everything/` (version 0.57.2)
- Manifest targets: `.antigravity-plugin/plugin.json`, `rules/AGENTS.md`, and root `hooks.json`

## Verified Capabilities (Mechanism Only)

### 1. Packaging & Manifest Lockstep (Phase 1)
- Manifest: `plugins/harness-everything/.antigravity-plugin/plugin.json` conforms to the AGY Customization System specification (`name`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`).
- Rules Integration: `plugins/harness-everything/rules/AGENTS.md` is synchronized from the repository root `AGENTS.md` byte-for-byte.
- Canonical Skills: All canonical skills are present in `plugins/harness-everything/skills/` with valid frontmatter and token count $\le 500$.
- Verified by: `npm run test:plugin:agy` (`ci/agy-plugin-package.test.js`).

### 2. Lifecycle Hook Enforcement (Phase 2 — Mechanism Verified)
The AGY plugin provides lifecycle adapters communicating over `stdin`/`stdout` using the AGY protojson camelCase format:
- `PreInvocation` (`agy-pre-invocation.js`): Injects Kernel Router invariant advice and ledger lessons into the conversation via `injectSteps`, bridging `conversationId` to session state for workflow persistence.
- `PreToolUse` (`agy-pre-tool.js`): Intercepts `run_command`, `write_file`, `edit_file`, `write_to_file`, `replace_file_content`, and `multi_replace_file_content`:
  - Enforces workspace containment (denies mutations to out-of-bounds paths).
  - Invokes canonical Action Gate policies (`action-gate.js` against `action-gate-rules.json`) to reject destructive operations, force-pushes, publish, and reset.
- `PostToolUse` (`agy-post-tool.js`): Captures exit codes and errors into session state (`handoff-state.json`) via canonical state persistence.
- `Stop` (`agy-stop.js`): Implements Verify-Before-Claim by inspecting real session verification state in `handoff-state.json`, returning `{"decision": "continue"}` when completion is claimed with unverified edits, while respecting `continuationActive` to prevent infinite loops.
- `SessionStart` (`agy-session-start.js`): Injects active Harness OS banner.
- Verified by: `npm run test:plugin:agy` (`ci/agy-hooks.test.js`).
- Host loading & live execution: Not yet observed in a live IDE/CLI session; tracked in follow-up issue #514.

### 3. Automated Synchronization & CLI (Phase 3 — Mechanism Verified)
- `scripts/plugin-sync.sh` and `scripts/plugin-sync.js` support `--host agy` (and `--host all`):
  - Under default `--host all`, does not select AGY solely on an unrelated `.agents/` directory; requires AGY CLI (`agy`) or existing AGY config/target.
  - Supports explicit `--host agy` to install.
  - Implements clean, atomic update via temporary staging and backup rollback, removing obsolete files from target.
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
