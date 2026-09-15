# Codex action-gate policy

This document records the Codex-specific action-gate contract. It intentionally differs from Claude Code because the two hosts expose different approval semantics.

## Current official capability boundary

Harness treats the current Codex hooks documentation as the release-behavior contract.

### PreToolUse

For Codex, Harness may safely block a covered local tool call with a supported deny/block result or exit code 2. Harness must not emit `permissionDecision: "ask"`: Codex currently parses that value but does not support it as an authorization decision, so relying on it would be fail-open.

The packaged action gate therefore keeps the existing fail-closed behavior for a destructive rule match:

```text
covered local tool
    -> PreToolUse
    -> Harness destructive rule match
    -> exit 2 / block
```

An internal failure in this pre-action path also remains fail-closed.

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

## Native execpolicy prompt rules

Codex rules/execpolicy can express native `prompt` decisions for command prefixes. That is a promising native confirmation path, but Harness does not automatically install or bundle those rules yet.

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
Harness PreToolUse block
Codex execpolicy/native prompt
PermissionRequest defer/allow/deny
PostToolUse execution result
```

Package and mechanism tests must not be promoted to `Live verified` in the compatibility matrix.

## Tool coverage

Current Harness PreToolUse enforcement remains wired to the tool set explicitly covered by the package (`Bash|apply_patch`). Codex hooks can cover additional local function/MCP tools, but those tools must not be claimed as action-gated until Harness has a safe classifier/rule representation for their structured inputs. Hosted or specialized tool paths may have different hook behavior and remain outside this guarantee unless separately verified.

## References

- Codex Hooks: https://developers.openai.com/codex/hooks
- Codex Rules: https://developers.openai.com/codex/rules
- Codex agent approvals and security: https://developers.openai.com/codex/agent-approvals-security
- Codex configuration reference: https://developers.openai.com/codex/config-reference

Related tracking: #82, #85, #98, #100, #109, #110.
