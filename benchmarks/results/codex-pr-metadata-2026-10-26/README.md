# Codex PR metadata action-gate evidence

| Item | Evidence / disposition |
| --- | --- |
| Scope | Codex exact PR title/body update; no #376 governance changes, #341 E1 credit or #320 promotion |
| Base | `b733cadec17542b9ae30aabb50c1ba3481a58d74` (fresh `origin/main`, 2026-10-26) |
| RED | `db6c29b`; [red.log](red.log): 12 expected metadata failures, dependency/baseline tests PASS |
| GREEN | `fd371bf`; [green.log](green.log): all boundary checks PASS |
| Reproduce | `node ci/action-gate.test.js`; `node ci/mechanism-2aa-codex-action-gate-policy.test.js`; `node ci/mechanism-task-git-authorization.test.js` |
| Package | `npm run plugin:sync`; canonical/package action gate byte comparison and identical lifecycle tests |
| Full regression | Pending `npm run verify:all` |
| Independent review | Pending Luna xhigh cold review |
| Candidate live Host | UNCHECKED: current session loads immutable installed runtime `0.42.0-f51078676b56`, not this candidate; no hook/trust configuration changed |

## Original rejection provenance

- Observed 2026-10-26T01:12:15.045Z; session `01a175b3-4583-7590-9c9d-f71a9439ae8e`, tool call `exec-8e76e1be-e5a3-493d-807b-2ad6cdbc7c31`.
- Actual tool: `mcp__codex_apps__github__update_pull_request`; arguments: `repository_full_name`, `pr_number: 376`, `body` only.
- Audit: `structured-mutate`, `mutate`/`gated`, host `codex`, `rejected`, reason `host-ask-decision-unverified-or-unsupported`.
- Exact input SHA-256: `b9bda7116fb01c045edd71a6b4fc3091c0ab707e0b797f1b4efca6e7a4edc87b`. Audit intentionally omits raw body.
- Local audit: `~/.agents/harness-everything/workspaces/harness-everything-4534d9804d9c/state/sessions/01a175b3-4583-7590-9c9d-f71a9439ae8e/action-gate/exec-8e76e1be-e5a3-493d-807b-2ad6cdbc7c31.json`.
- Transcript: `~/.codex/sessions/2026/10/26/rollout-2026-10-26T08-54-05-01a175b3-4583-7590-9c9d-f71a9439ae8e.jsonl`, call `call_0a3ca81d5e134c76a9339a116e7fe417` supplies only those keys and records the matching Hook rejection.
- Current connected GitHub tool schema exposes those selectors, optional title/body and separate state/base_branch/maintainer_can_modify; new exception rejects the latter keys even when null.

## Boundary controls

- Body-only, title-only and combined payloads; exact bare/provider operation and both connected Codex naming forms.
- State/reopen/retarget/maintainer/unknown/mixed/malformed payloads and similar names retain Gate; all supported required-hint envelopes retain Gate.
- Other hosts retain existing structured rules. Create PR, merge, close, delete, deploy, publish, send and force-push controls remain unchanged.
- Canonical/package tests verify descriptor/hash, redacted audit provenance, PostToolUse success/failure, changed-payload integrity violation and rejected mutation outcomes.
- No actual destructive remote negative control is executed. Mechanism PASS is not live Host PASS.
