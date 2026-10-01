# Fable behavior profiles and runtime model floors

Fable profiles define **how work is performed and which role owns it**. They do not select or require a branded runtime model. The historical names `haiku`, `sonnet`/`sonnect`, and `opus` remain accepted aliases so existing prompts keep working.

## Behavior Profile Matrix

| Canonical profile | Legacy alias | Role | Typical work | Named agent |
|---|---|---|---|---|
| `mechanical` | `haiku` | Mechanical worker | Bulk edits, format conversion, boilerplate, structured extraction | `fable-worker-haiku` |
| `reasoning` | `sonnet` / `sonnect` | Reasoning worker | Non-trivial implementation, research synthesis, analysis, bounded design | `fable-worker-sonnet` |
| `orchestrator` | `opus` | Orchestrator | Stage decomposition, dependency management, cross-stage synthesis, architecture/final decisions | `fable-orchestrator` |
| verifier | — | Cold reviewer | Spec-versus-artifact checks and independent re-verification | `fable-verifier` |

The machine-readable source is `fable-mode/behavior-profile-matrix.json`.

## Runtime Model Floor Matrix

Runtime floors are **host-specific recommendations**, not Fable identity and not an execution gate. A newer compatible model/effort may be used. If the active runtime is below or cannot be compared to the floor, Fable continues with the same behavior profile and records the status visibly.

| Fable profile | Claude recommended floor | Codex recommended floor |
|---|---|---|
| `orchestrator` | Opus 5.5+ / medium+ | GPT-6 Sol+ / xhigh+ |
| `reasoning` | Sonnet 5.5+ / medium+ | GPT-6 Sol+ / medium+ |
| `mechanical` | Haiku 5.5+ | GPT-6 Luna 6+ / xhigh+ |

The machine-readable source is `fable-mode/runtime-model-floor-matrix.json`. These are Harness support baselines, not claims that every host currently exposes every listed model.

## Resolution

```text
task
  -> behavior profile
  -> named role / agent
  -> host adapter
  -> advisory runtime floor
  -> actual host-selected model
  -> execute the SAME behavior contract
```

`fable on haiku` normalizes to `mechanical`; `fable on sonnect` normalizes to `reasoning`; `fable on opus` normalizes to `orchestrator`. None of these aliases means switching the host to that branded model.

The audit record uses `requestedProfile`, `effectiveProfile`, `profileAlias`, `assignedRole`, `runtimeModel`, `runtimeEffort`, `recommendedRuntimeFloor`, `runtimeFloorStatus`, and `runtimeFloorReason`, plus stage verification fields.

A `below-recommended` or `unknown` runtime-floor result is advisory and does not block Fable. Missing named-agent capability is separate: the existing `inline` or `stop` fallback policy decides whether the same profile runs inline or the stage is blocked.

See [execution phases](execution-phases.md) for the staged run contract.
