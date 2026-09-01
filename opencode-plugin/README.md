# Harness Enforcement Plugin for opencode

Intended to add hard enforcement gates for Harness skills in opencode, addressing the limitation that skills are advisory-only on that platform. **Not yet functional** - see the status note below.

## Problem

In Claude Code, Harness hooks ENFORCE rules (hard gate). In opencode, skills only SUGGEST rules (soft guidance). This means:
- Under pressure, agents can bypass skills
- Verification can be skipped
- Circuit breaker patterns don't trigger

## Solution

This plugin implements three enforcement mechanisms:

### 1. Post-Edit Verification Gate

**File:** `hooks/post-edit.js`

Records every edit and tracks verification status.

### 2. Pre-Complete Verification Gate

**File:** `hooks/pre-complete.js`

Blocks completion until verification runs after edits.

### 3. Circuit Breaker

**File:** `hooks/circuit-breaker.js`

Enforces Rule of 3:
- Tracks failure signatures
- Blocks edits after 3 failures on same signature
- Requires reflection (zoom-out) before resuming

### 4. Compliance Monitor

**File:** `hooks/compliance.js`

Tracks compliance metrics:
- Verification compliance rate
- Circuit breaker trips
- Pressure resistance metrics

> **Status: not loadable by opencode.** This directory holds working
> enforcement logic, but not in a shape opencode can load. Verified against
> the opencode plugin docs (https://opencode.ai/docs/plugins/):
>
> - A plugin is a **JS/TS module** that exports a function returning its hooks
>   (`export const MyPlugin: Plugin = async (ctx) => ({ ... })`), registered
>   through the `plugin` array in `opencode.json` or by being dropped in
>   `.opencode/plugins/`. There is **no** mechanism that maps event names to
>   external script paths from a JSON manifest, which is what `plugin.json`
>   here assumes.
> - opencode has **no `postEdit` and no `preComplete` events**. Its tool hooks
>   are `tool.execute.before` / `tool.execute.after`; there are also file,
>   session, permission and shell hooks.
> - Blocking is done by **throwing an Error inside `tool.execute.before`** (or
>   denying in the permission hook), not by a child process exiting non-zero.
>
> So the hooks below have never fired inside a real opencode session. Porting
> them is tracked in issue #37.

## What each file does

`ci/mechanism-2n-opencode-plugin.test.js` asserts manifest/disk parity and
runs the hook scripts directly, which proves the *logic* works. It does not
prove opencode invokes it - nothing does yet.

| Key in `plugin.json` | Files | Reality |
|---|---|---|
| `hooks` | `post-edit.js`, `pre-complete.js` | Written for `postEdit` / `preComplete`; neither event exists in opencode |
| `onDemandHooks` | `verify.js`, `circuit-breaker.js`, `compliance.js` | Standalone CLIs; `verify.js` is named in `pre-complete.js`'s block message, the other two read a payload on stdin |

`verify.js` resolves its verification commands from `process.cwd()/package.json`.
Run it from the workspace under test, never from the Harness repo root - from
there it would re-enter `npm test` from inside `npm test`.

## Installation

1. Copy `opencode-plugin/` to your opencode config directory
2. Add to `opencode.json`:

```json
{
  "plugins": ["./opencode-plugin"]
}
```

## Configuration

Edit `plugin.json` to configure:

```json
{
  "config": {
    "verificationRequired": true,
    "circuitBreakerEnabled": true,
    "maxRetries": 3,
    "verificationCommands": ["npm test", "npm run lint", "npm run build"]
  }
}
```

## Expected Impact

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| Pressure pass rate | 0% | 80%+ |
| Verification compliance | Unknown | 95%+ |
| Circuit breaker enforcement | Advisory only | Hard gate |

## Limitations

1. **Requires opencode plugin support** - opencode must support post-edit hooks
2. **State files in user home** - Uses `~/.harness-state/` for persistence
3. **No cross-session state** - Each session starts fresh (by design)

## Testing

Run the behavioral evals to verify:

```bash
node behavioral-evals/run.js run --engine opencode
```

Expected improvement in pressure cases.
