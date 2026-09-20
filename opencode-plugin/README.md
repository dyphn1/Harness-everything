# Harness Guidance + Rule-of-3 Plugin for opencode

Adds lifecycle guidance, verification reminders, and the Rule-of-3 zoom-out boundary in opencode, addressing the
limitation that skills are otherwise advisory-only on that platform.

> **Evidence boundary:** the plugin is implemented against opencode's real plugin API and covered by deterministic mechanism tests. Live plugin loading remains unverified beyond one scoped surface: retained evidence supports project-scope `.js` loading and edit/verification state on OpenCode 1.18.31 (macOS) — [live-host evidence](../benchmarks/results/live-host/opencode-2026-09-16/README.md). The retained snapshot predates #190 and is historical evidence only. Current behavior has no permanent post-reflection hard lock; only the third matching verification failure pauses edits for reflection. Reflection was operator-seeded, then agent-rewritten, so no behavioral-effectiveness claim is made. Global scope, npm-package installation, and other host versions remain unverified. See [`../docs/platform-capabilities.md`](../docs/platform-capabilities.md).

## Problem

Harness now keeps workflow/productivity rules advisory on both Claude Code and opencode. Explicit permission boundaries and the third-failure Rule-of-3 reflection are the intentional blocking exceptions. In opencode, skills
only SUGGEST rules (soft guidance). This means:
- Under pressure, agents can bypass skills
- Verification can be skipped
- Circuit breaker patterns don't trigger

## The plugin

**File:** `index.mjs` - a single ESM module, because that is what opencode
actually loads: a JS/TS file exporting a function that returns a hooks
object (see https://opencode.ai/docs/plugins/). There is no manifest-to-script
mechanism; an earlier version of this plugin assumed one (a `plugin.json`
mapping event names to standalone scripts) and opencode never invoked it -
see issue #37 for how that was found and fixed. **Naming caveat (issue
#127):** opencode's discovery glob only matches `*.js`/`*.ts`, so the file
must be copied to a `.js` name when installed - see Installation below.

It implements three lifecycle mechanisms across opencode's real hooks:

The module follows opencode's V1 plugin contract directly: the named
`HarnessEnforcement` export is an async factory receiving the opencode context
(`client`, `directory`, `project`, `worktree`, and `$`) and returning the hook
map. Copying this one file into `.opencode/plugins/` under a `.js` name is
enough for opencode to discover and invoke it; `plugin.json` is only a
repository
inventory and is not an opencode runtime manifest. The hook callbacks use the
V1 `(input, output)` shape, including
`output.args` when the host supplies tool arguments only in the result object.

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

### 3. Rule-of-3 zoom-out boundary (`tool.execute.before` + the verification observer above)

Enforces Rule of 3 on repeated verification failures (same failing command +
truncated error, not arbitrary tool failures - `tool.execute.after` has no
normalized success/failure field to key a signature on for tools in general):
- 3rd failure on the same signature forces a reflection message instead of a
  retry nudge
- the follow-up asks for a tokenized `zoom-out-report.md` artifact with the
  required reflection sections; the artifact is accepted through the real
  edit hook and records `lastReflection`
- the same signature failing again after that reflection was recorded
  hard-locks the breaker
- after a valid reflection, the signature count resets; another three matching failures trigger another zoom-out
  or a new session starts

Idle handling is bounded: after a failed verification, the plugin records that
the follow-up is pending and ignores repeated `session.idle` events until a new
code edit arrives. If prompt delivery fails, the exact follow-up text is saved
and retried on the next idle event without re-running verification or adding a
new breaker failure. A reflection artifact itself does not count as a code edit.

## Installation

Copy `index.mjs` into opencode's plugin directory **under a `.js` filename** -
it is self-contained, no sibling files required:

```bash
mkdir -p .opencode/plugins
cp opencode-plugin/index.mjs .opencode/plugins/harness-enforcement.js   # project-level
# or
mkdir -p ~/.config/opencode/plugins
cp opencode-plugin/index.mjs ~/.config/opencode/plugins/harness-enforcement.js  # global
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

**File:** `hooks/verify.js` - the same "run available npm scripts" logic as
`index.mjs`'s verification gate, kept as a standalone command:

```bash
node opencode-plugin/hooks/verify.js
```

Run it from the workspace under test, never from the Harness repo root - from
there it would re-enter `npm test` from inside `npm test`. It is intentionally
a separate copy of the logic, not a shared import, so `index.mjs` stays a
single portable file for the installation step above.

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

The reflection report is `zoom-out-report.md` in the session state directory.
It must contain `## Goal`, `## Failed Attempts`, `## Verified Facts`,
`## Diagnosis`, `## Decision`, with the first non-empty line under `## Decision`
starting with `RESUME:` or `ESCALATE:`, and the token supplied in the
forced-reflection prompt. `apply_patch` reflection writes are accepted when
their patch target names the report file.

## Testing

`ci/mechanism-2n-opencode-plugin.test.js` imports `index.mjs` and drives its
exported hooks directly with a mock `client`/`event` context - the same shape
opencode's plugin loader passes in - covering the edit → idle → follow-up →
reflection-artifact → retry → fresh three-failure cycle, repeated-idle idempotency,
session isolation, reset behavior, legacy-state migration, corrupt-state
fail-closed behavior, and patch-based reflection writes.

It does not launch a real opencode process; the test remains a deterministic
hook-sequence check against the documented and source-verified hook signatures.
A passing test is therefore mechanism evidence, not live-host loading evidence.
Live-host evidence and the install-filename loadability guard live elsewhere:
the host session artifact is
[`benchmarks/results/live-host/opencode-2026-09-16/`](../benchmarks/results/live-host/opencode-2026-09-16/),
and `ci/mechanism-30-opencode-plugin-loadability.test.js` (npm script
`test:opencode:loadability`) fails any change that reintroduces a
silently-ignored install filename such as `harness-enforcement.mjs`.
