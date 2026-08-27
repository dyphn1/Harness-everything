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
