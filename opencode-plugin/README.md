# Harness Enforcement Plugin for opencode

This plugin adds hard enforcement gates for Harness skills in opencode, addressing the limitation that skills are advisory-only in this platform.

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

## How each hook is invoked

`plugin.json` splits the five hooks by invocation model. The split is asserted
by `ci/mechanism-2n-opencode-plugin.test.js`, which fails if a hook file exists
without a declaration or a declaration points at a missing file.

| Key | Hooks | Fired by |
|---|---|---|
| `hooks` | `post-edit.js`, `pre-complete.js` | opencode lifecycle events (`postEdit`, `preComplete`) |
| `onDemandHooks` | `verify.js`, `circuit-breaker.js`, `compliance.js` | invoked explicitly — `verify.js` is named in `pre-complete.js`'s block message; the other two read a payload on stdin |

`onDemandHooks` is a Harness-side declaration, not an opencode feature: those
three are **not** auto-fired by the runtime today. Binding `circuit-breaker.js`
to a real lifecycle event requires confirming opencode's event names against its
plugin API first — tracked in issue #37.

`verify.js` resolves its verification commands from `process.cwd()/package.json`.
Run it from the workspace under test, never from the Harness repo root — from
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
