# Fable model matrix and execution audit

Issue #27 defines three explicit execution modes. The mode selector is the
machine-readable gate; this document is the human-facing contract.

| Mode | Use for | Named agent |
|---|---|---|
| Haiku | Bulk mechanical work and format conversion | `fable-worker-haiku` |
| Sonnet | Non-trivial implementation, research synthesis, bounded reasoning | `fable-worker-sonnet` |
| Opus | Macro orchestration, cross-stage synthesis, high-stakes architecture and final decisions | `fable-orchestrator` |

Use the explicit entrypoints `fable-haiku`, `fable-sonnet`, and `fable-opus`.
The accepted input `sonnect` normalizes to Sonnet. A normal Tier 2 prompt does
not select a fable model.

## Deterministic selection

Before each stage, run `fable-mode/scripts/model-selector.js` with the requested
mode, the runtime's available modes, the host model, and the stage contract:

```text
node fable-mode/scripts/model-selector.js --requested opus --available opus,sonnet,haiku --available-agents fable-orchestrator,fable-worker-sonnet,fable-worker-haiku --fallback stop --host-model opus --stage-brief "Synthesize the architecture" --pass-condition "ADR and dependency map exist" --verification-command "npm test" --verifier-result pending
```

The JSON result always records `requestedModel`, `effectiveModel`,
`fallbackReason`, `stageBrief`, `passCondition`, `verificationCommand`, and
`verifierResult`, plus available agents, status, agent, and escalation state. The
CLI appends the same record as one JSON line to
`.claude/harness-state/fable-mode/audit.jsonl` (or the path supplied by
`--audit-file`).

If the requested model is unavailable, `--fallback inline` records the declared
host model and a visible reason. `--fallback stop` emits `status: blocked`, a
null effective model, and exit code 2. Neither path silently downgrades.

The orchestrator still owns scope lock, at most two full replans, stage
contracts, worker non-recursion, cold verification, and escalation. The native
host TODO tracker or a Markdown checklist records stage progress; no CLI TODO
state machine is part of this contract.
