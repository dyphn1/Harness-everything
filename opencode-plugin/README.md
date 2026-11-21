# Harness Guidance and Verification Plugin for OpenCode

Adds edit tracking, verification reminders, prompt routing, and observation hooks for OpenCode.

> **Evidence boundary:** the plugin is covered by deterministic mechanism tests. Live plugin loading remains unverified beyond one scoped surface: retained evidence supports project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS) — [live-host evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md). That retained snapshot is historical: its final state was post-reset; the hard-lock was only an interactive observation with no retained blocked-tool trace. Reflection was operator-seeded, then agent-rewritten, so no behavioral-effectiveness claim is made. The current plugin does not force reflection or block edits based on verification history. Global scope, npm-package installation, and other host versions remain unverified. See [`../docs/platform-capabilities.md`](../docs/platform-capabilities.md).

## Problem

Harness keeps workflow and productivity guidance advisory on both Claude Code and OpenCode. Explicit permission boundaries remain independent contracts. In OpenCode, skills
only SUGGEST rules (soft guidance). This means:
- Under pressure, agents can bypass skills
- Verification can be skipped

## The plugin

**File:** `index.mjs` - the ESM plugin entrypoint. The OpenCode 2 adapter uses
the documented prompt and context hooks; the V1 factory remains available for
existing OpenCode 1 installations. There is no manifest-to-script
mechanism; an earlier version of this plugin assumed one (a `plugin.json`
mapping event names to standalone scripts) and opencode never invoked it -
see issue #37 for how that was found and fixed. **Naming caveat (issue
#127):** opencode's discovery glob only matches `*.js`/`*.ts`, so the file
must be copied to a `.js` name when installed - see Installation below.

It implements edit tracking and verification reminders across OpenCode's hooks:

The V1 factory follows opencode's plugin contract directly: the named
`HarnessEnforcement` export is an async factory receiving the opencode context
(`client`, `directory`, `project`, `worktree`, and `$`) and returning the hook
map. Copying this one file into `.opencode/plugins/` under a `.js` name is
enough for opencode to discover and invoke it; `plugin.json` is only a
repository
inventory and is not an opencode runtime manifest. The hook callbacks use the
V1 `(input, output)` shape, including
`output.args` when the host supplies tool arguments only in the result object.
OpenCode 2's prompt injection and observation path resolves the canonical
`harness-everything/scripts/kernel-router.js` and
`hooks/scripts/lib/observations.js` from an ancestor Harness checkout/runtime.

### 1. Edit tracking (`tool.execute.after`)

Fires after every `edit`, `write` or `apply_patch` tool call and marks
verification as pending.

### 2. Verification reminder (`event`, on `session.idle`)

opencode has no "before complete" hook to block the way Claude Code's Stop
hook does. `session.idle` - fired when the agent's turn ends - is the closest
analog, and it cannot be blocked (the hook has no return value that denies
it). So when it fires with verification still pending, the plugin runs the
available `npm test` / `npm run lint` / `npm run build` scripts right there,
and on failure calls `client.session.prompt()` to push a synthetic follow-up
message into the session - forcing the agent to keep working instead of
actually stopping.

The async runner streams stdout/stderr and gives the **whole ordered sequence**
(`test`, `lint`, `build`) one wall-clock budget: 10 minutes by default, overridden
by `HARNESS_VERIFY_TIMEOUT_MS`. It reports progress every 15 seconds in the
plugin log. No later script starts after the budget expires. Each run is
classified as `pass` (exit 0), `test_failure` (a real nonzero exit), `timeout`
(the sequence deadline expired), or `execution_error` (spawn failure, external
signal, or cancellation). The follow-up describes the verification outcome.

| Resource | Bound / behavior |
|---|---|
| Retained output | First and last 2,000 characters per stream; the final diagnostic shares a 2,000-character budget across streams, plus labels/elision markers |
| Timeout/cancel | Terminate the shell/npm/script process group, then force-kill after 150 ms on POSIX; Windows uses `taskkill /T /F` |
| Concurrent lifecycle | Duplicate idle events share the active run; a code edit or session reset aborts it; an idle arriving during cancellation waits for cleanup before verifying the newer edits; the V2 event stream continues consuming cancellation events; disposal awaits active child cleanup; stale results cannot clear newer edits or recreate deleted state |

The event loop remains available while scripts run. The output-retention limit
never becomes a check verdict. Mechanism tests cover large output, shared
budget, child cleanup and concurrent hooks; these are deterministic mechanism
evidence, not a new live-host verification claim. Processes deliberately
escaping the process group are outside this cleanup boundary.

Idle handling is bounded: after a failed verification, the plugin records that
the follow-up is pending and ignores repeated `session.idle` events until a new
code edit arrives. If prompt delivery fails, the exact follow-up text is saved
and retried on the next idle event without re-running verification.

## Installation

**OpenCode 2.x:** the module default-exports
`{ id: "harness.enforcement", setup(ctx) }` and registers
`ctx.session.hook("prompt|context")`, `ctx.tool.hook("execute.before|after")`,
plus `ctx.event.subscribe()` through the OpenCode 2 plugin context. OpenCode 2
never loads a named-export-only plugin: it fails with `Plugin must export a
default definition with an id and an effect or setup function`
(SchemaError at `["default"]`). The named `HarnessEnforcement` export stays
available for OpenCode 1.x hosts: it receives the V1 context
(`{client, directory}`) and returns a V1 hooks object
(`tool.execute.before`, `tool.execute.after`, `event`); the V2 `setup`
adapter wraps that factory and maps the V2 hook events onto it, so the
enforcement logic is shared, not duplicated.

The prompt/context routing and System One observation hooks are V2-only. The
V1 factory keeps its existing enforcement hooks; it does not capture turns.

When OpenCode runs on Bun, its Harness router needs `node` on the OpenCode
process's `PATH`. Run `node --version` from the same environment that launches
OpenCode and check it against the [Harness Node.js baseline](../docs/repository-contract.md).
If the router cannot start or load, OpenCode still admits prompts and logs a
`router-unavailable` warning with a reason and per-plugin count.

Direction:
named factory (V1 hosts/tests) → default-export setup adapter → V2 domains.

Copy `index.mjs` into opencode's plugin directory **under a `.js` filename**.
The router and observation hooks resolve from a Harness checkout above the
plugin, or from sibling `harness-everything/`, `hooks/scripts/`, and
`scripts/lib/` runtime directories. A project install inside the Harness
checkout already has those files.

```bash
mkdir -p .opencode/plugins
cp opencode-plugin/index.mjs .opencode/plugins/harness-enforcement.js   # project-level
# or
mkdir -p ~/.config/opencode/plugins
cp opencode-plugin/index.mjs ~/.config/opencode/plugins/harness-enforcement.js  # global
mkdir -p ~/.config/opencode/hooks ~/.config/opencode/scripts
cp -R harness-everything ~/.config/opencode/
cp -R hooks/scripts ~/.config/opencode/hooks/
cp -R scripts/lib ~/.config/opencode/scripts/
```

Restart OpenCode after copying so the plugin is discovered at startup.

The destination extension matters: opencode's plugin auto-discovery scans
only `*.js` / `*.ts` files in those directories (`{plugin,plugins}/*.{ts,js}`
in its v1 loader), so a `.mjs` copy is **silently never loaded** - no error,
no hooks, no state. Verified live on opencode 1.18.31 with an extension A/B
probe (see
[`benchmarks/results/live-host/opencode-2026-09-16/probe-control.md`](../benchmarks/results/live-host/opencode-2026-09-16/probe-control.md)).

opencode auto-loads `.js`/`.ts` files dropped in those directories at startup -
no `opencode.json` entry needed. This procedure tests directory discovery;
explicit local-file configuration and npm-package installation are separate
installation surfaces and were not verified in this run.

## Manual verification CLI

**File:** `hooks/verify.js` - a standalone "run available npm scripts" command:

```bash
node opencode-plugin/hooks/verify.js
```

Run it from the workspace under test, never from the Harness repo root - from
there it would re-enter `npm test` from inside `npm test`. The manual CLI retains its synchronous per-command budget and 16 MiB capture
limit; the async sequence budget and streaming behavior above apply to the
plugin only. Keeping its implementation separate preserves the single-file
plugin installation contract.

`plugin.json` records this standalone helper for repository parity checks; it
does not configure opencode. The runtime module is `index.mjs`.

## State and reset contract

State is persisted per workspace and session under
`~/.agents/harness-everything/workspaces/<workspace-key>/state/sessions/<session-id>/`.
The plugin shares this layout with Harness's CJS hooks. A new session ID gets a
new state stream, and `session.created` clears a reused session ID. A
`session.deleted` event removes only that session's state. The old ambiguous
`~/.harness-state/` files are migrated into the first workspace-keyed root that
loads the plugin; conflicting or unsupported entries remain in place for
recovery. Session IDs such as `.` or `..` are hashed
into safe child names, and reset only removes a path proven to remain under the
session root.

## Testing

`ci/mechanism-2n-opencode-plugin.test.js` imports `index.mjs` and drives its
exported hooks directly with a mock `client`/`event` context - the same shape
OpenCode's plugin loader passes in - covering edit → idle → reminder, repeated
failures, legacy pending state remaining inert, prompt-delivery retry,
repeated-idle idempotency, session isolation, reset behavior, and legacy-state
migration. `ci/mechanism-2p-opencode-v2-entrypoint.test.js` exercises the same
edit and legacy-state paths through the default V2 export.

It does not launch a real opencode process; the test remains a deterministic
hook-sequence check against the documented and source-verified hook signatures.
A passing test is therefore mechanism evidence, not live-host loading evidence.
Live-host evidence and the install-filename loadability guard live elsewhere:
the host session artifact is
[`benchmarks/results/live-host/opencode-2026-09-16/`](../benchmarks/results/live-host/opencode-2026-09-16/),
and `ci/mechanism-30-opencode-plugin-loadability.test.js` (npm script
`test:opencode:loadability`) fails any change that reintroduces a
silently-ignored install filename such as `harness-enforcement.mjs`.
