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
- the same signature failing again after a reflection was recorded hard-locks
  the breaker
- once hard-locked, `tool.execute.before` throws on any `edit`/`write`/
  `apply_patch` call, blocking further edits until the state file is cleared
  or a new session starts

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

## State

Uses `~/.harness-state/` for persistence (`edit-state.json`,
`circuit-breaker.json`, `compliance.json`). Each session starts fresh only in
the sense that opencode restarts the plugin per process; the state files
themselves persist across sessions until cleared.

## Testing

`ci/mechanism-2n-opencode-plugin.test.js` imports `index.mjs` and drives its
exported hooks directly with a mock `client`/`event` context - the same shape
opencode's plugin loader would pass in - covering edit tracking, the
verification gate, the three-strikes reflection trip, and the post-reflection
hard lock. It does not launch a real opencode process (opencode requires Bun
and was not available to install in this repo's CI/dev environment); it
verifies the plugin's exported hooks behave correctly against the documented
and source-verified hook signatures.
