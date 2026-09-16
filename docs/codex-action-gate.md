# Codex action-gate policy

This document records the Codex-specific action-gate contract. It intentionally differs from Claude Code because the two hosts expose different approval semantics.

## Current official capability boundary

Harness treats the current Codex hooks documentation as the release-behavior contract. Non-managed command hooks must be reviewed/trusted before they run, so plugin installed/enabled state alone is not live-hook evidence.

### PreToolUse

For Codex, Harness may safely block a covered local tool call with a supported deny/block result or exit code 2. Harness must not emit `permissionDecision: "ask"`: Codex currently parses that value but does not support it as an authorization decision, so relying on it would be fail-open.

The documented Codex `PreToolUse` payload includes `session_id`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, and the current permission mode. Harness uses the stable identifiers only for audit/attribution and never treats them as authorization.

The packaged action gate therefore keeps the existing fail-closed behavior for a destructive rule match:

```text
covered local tool
    -> codex-action-gate-pre.js
    -> PreToolUse attribution (only when explicitly enabled)
    -> action-gate.js classifier
    -> Harness destructive rule match
    -> exit 2 / block
```

An internal failure in this pre-action path also remains fail-closed.

### Live PreToolUse attribution probe

`codex-action-gate-pre.js` is a Codex-specific adapter around the shared action-gate core. Its attribution mode is disabled by default and does not change authorization semantics.

Enable it only for live verification by setting:

```text
HARNESS_ACTION_GATE_ATTRIBUTION_DIR=<known output directory>
HARNESS_ACTION_GATE_RUN_NONCE=<optional test-run label>
```

When the `PreToolUse` entry point actually runs, the adapter writes a small JSON artifact containing:

- event kind (`codex-pretooluse-enter`);
- timestamp;
- detected host;
- session / turn / tool-use identifiers when available;
- tool name and permission mode;
- SHA-256 of the exact tool payload;
- optional run nonce.

The artifact does **not** persist the raw command/tool input, working directory, or transcript path. If diagnostic writing fails, the adapter still delegates to the normal action-gate result; attribution failure cannot convert a destructive block into authorization.

For the #110 live matrix, compare at least `approvals_reviewer = "user"` and `approvals_reviewer = "auto_review"` with distinct run nonces. A persisted entry artifact proves that the Codex PreToolUse adapter was launched for that invocation; the resulting action-gate exit/output still determines the Harness disposition.

### PermissionRequest

Codex exposes a separate `PermissionRequest` lifecycle event when Codex is already going to request approval. A PermissionRequest hook can refine that request, but the event is not a mechanism for manufacturing an approval prompt for an otherwise permitted command.

Harness therefore registers `codex-permission-request.js` as an observer only:

- it records that Codex entered its native approval flow;
- it records the Harness rule match when the current rule table recognizes the tool input;
- it stores a SHA-256 of the exact tool input rather than the raw command/tool arguments;
- it returns no `allow`, `deny`, or `ask` decision;
- an observer/audit failure returns no authorization decision, so Codex's already-active native approval flow remains authoritative.

The current documented PermissionRequest payload does not provide the same `tool_use_id` correlation used by PreToolUse/PostToolUse. PermissionRequest evidence therefore explicitly records `exactToolCallCorrelation: false` and uses only the turn id plus the payload hash for limited correlation.

### PostToolUse

Codex uses the documented `PostToolUse` lifecycle for completion evidence, including non-zero Bash outcomes. Harness does not declare a Codex `PostToolUseFailure` hook.

`codex-action-gate-post.js` is kept in canonical `hooks/scripts/` and copied into the plugin package by `sync-openai-plugin.js`. This prevents a package sync from deleting the Codex-only adapter.

## Approval reviewer boundary

`approvals_reviewer = "auto_review"` changes who reviews **eligible approval requests**. The official configuration reference explicitly says it does not change sandboxing or actions already allowed inside the sandbox. The reviewer only sees actions that already need approval.

Therefore a command that executes under `auto_review` is not, by itself, evidence that the Harness action-gate was bypassed. First preserve the PreToolUse attribution artifact and determine whether the Harness hook actually fired for that invocation.

## Native execpolicy prompt rules

Codex rules/execpolicy can express native `prompt` decisions for command prefixes. The current Rules documentation describes this mechanism as controlling commands Codex may run **outside the sandbox**, and the feature remains experimental. That is a promising native confirmation path, but Harness does not automatically install or bundle those rules yet.

Reasons:

1. the plugin packaging contract does not establish a plugin-owned execpolicy-rules component that Harness can assume is installed and active;
2. execpolicy is an approval/sandbox layer and is not proven to cover every destructive operation that may already be allowed in the active sandbox;
3. rule activation and approval behavior must be verified in the real Codex host before a hard safety guard is weakened.

Until live evidence establishes a guaranteed native approval path for a matched action, a Harness destructive match remains a hard PreToolUse block.

## Required live verification before native-prompt delegation

A future change may delegate selected destructive rules to Codex-native prompting only after preserving evidence for at least:

- `approval_policy = "on-request"`;
- `approval_policy = "never"`;
- granular approvals with rules enabled;
- `approvals_reviewer = "user"`;
- `approvals_reviewer = "auto_review"`;
- plugin-hook trust/review enabled in the actual host;
- Windows and one Unix-like environment where practical.

The evidence must distinguish:

```text
Harness PreToolUse entry attribution
Harness PreToolUse block
Codex execpolicy/native prompt
PermissionRequest defer/allow/deny
PostToolUse execution result
```

Package and mechanism tests must not be promoted to `Live verified` in the compatibility matrix.

## Tool coverage

Current Harness PreToolUse enforcement remains wired to the tool set explicitly covered by the package (`Bash|apply_patch`). Codex hooks can cover additional local function/MCP tools, but those tools must not be claimed as action-gated until Harness has a safe classifier/rule representation for their structured inputs. Hosted tools do not use the local function-tool hook path, and specialized tool paths may opt out; Codex documents tool hooks as a useful guardrail rather than a complete enforcement boundary.

## References

- Codex Hooks: https://developers.openai.com/codex/hooks
- Codex Rules: https://developers.openai.com/codex/rules
- Codex agent approvals and security: https://developers.openai.com/codex/agent-approvals-security
- Codex configuration reference: https://developers.openai.com/codex/config-reference

Related tracking: #82, #85, #98, #100, #109, #110.
