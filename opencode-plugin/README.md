# Harness Enforcement Plugin for opencode

Adds hard enforcement gates for Harness skills in opencode, addressing the
limitation that skills are otherwise advisory-only on that platform.

## Problem

In Claude Code, Harness hooks ENFORCE rules (hard gate). In opencode, skills
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
see issue #37 for how that was found and fixed.

It implements three enforcement mechanisms across opencode's real hooks:

The module follows opencode's V1 plugin contract directly: the named
`HarnessEnforcement` export is an async factory receiving the opencode context
(`client`, `directory`, `project`, `worktree`, and `$`) and returning the hook
map. Copying this one `.mjs` file into `.opencode/plugins/` is enough for
opencode to discover and invoke it; there is no manifest or sibling script to
configure. The hook callbacks use the V1 `(input, output)` shape, including
`output.args` when the host supplies tool arguments only in the result object.

### 1. Edit tracking (`tool.execute.after`)

Fires after every `edit`, `write` or `apply_patch` tool call and marks
verification as pending.

### 2. Verification gate (`event`, on `session.idle`)

opencode has no "before complete" hook to block the way Claude Code's Stop
hook does. `session.idle` - fired when the agent's turn ends - is the closest
analog, and it cannot be blocked (the hook has no return value that denies
it). So when it fires with verification still pending, the plugin runs the
available `npm test` / `npm run lint` / `npm run build` scripts right there,
and on failure calls `client.session.prompt()` to push a synthetic follow-up
message into the session - forcing the agent to keep working instead of
actually stopping.

### 3. Circuit breaker (`tool.execute.before` + the verification gate above)

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
- once hard-locked, `tool.execute.before` throws on any `edit`/`write`/
  `apply_patch` call, blocking further edits until the state file is cleared
  or a new session starts

Idle handling is bounded: after a failed verification, the plugin records that
the follow-up is pending and ignores repeated `session.idle` events until a new
code edit arrives. If prompt delivery fails, the exact follow-up text is saved
and retried on the next idle event without re-running verification or adding a
new breaker failure. A reflection artifact itself does not count as a code edit.

## Installation

Copy `index.mjs` into opencode's plugin directory - it is self-contained, no
sibling files required:

```bash
cp opencode-plugin/index.mjs .opencode/plugins/harness-enforcement.mjs   # project-level
# or
cp opencode-plugin/index.mjs ~/.config/opencode/plugins/harness-enforcement.mjs  # global
```

opencode auto-loads any file dropped in those directories at startup - no
`opencode.json` entry needed. (`opencode.json`'s `plugin` array is for npm
package names, not local file paths.)

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

## State and reset contract

State is persisted per workspace and session under
`~/.agents/harness-everything/workspaces/<workspace-key>/state/sessions/<session-id>/`.
The plugin shares this layout with Harness's CJS hooks. A new session ID gets a
new state stream, and `session.created` clears a reused session ID. A
`session.deleted` event removes only that session's state. The old ambiguous
`~/.harness-state/` files are left in place and are never claimed for the first
workspace that loads the plugin. Session IDs such as `.` or `..` are hashed
into safe child names, and reset only removes a path proven to remain under the
session root.

The reflection report is `zoom-out-report.md` in the session state directory.
It must contain `## Goal`, `## Failed Attempts`, `## Verified Facts`,
`## Diagnosis`, `## Decision`, a `RESUME:` or `ESCALATE:` decision, and the
token supplied in the forced-reflection prompt.

## Testing

`ci/mechanism-2n-opencode-plugin.test.js` imports `index.mjs` and drives its
exported hooks directly with a mock `client`/`event` context - the same shape
opencode's plugin loader passes in - covering the edit → idle → follow-up →
reflection-artifact → retry → hard-lock sequence, repeated-idle idempotency,
session isolation, reset behavior, and preservation of ambiguous legacy state.
It does not launch a real opencode process; the test remains a deterministic
hook-sequence check against the documented and source-verified hook signatures.
