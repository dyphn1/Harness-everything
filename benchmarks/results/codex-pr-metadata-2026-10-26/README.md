# Codex PR metadata action-gate evidence

| Item | Evidence / disposition |
| --- | --- |
| Scope | Codex exact PR title/body update; no #376 governance changes, #341 E1 credit or #320 promotion |
| Base | `b733cadec17542b9ae30aabb50c1ba3481a58d74` (fresh `origin/main`, 2026-10-26) |
| RED | `db6c29b`; [red.log](red.log): 12 expected metadata failures, dependency/baseline tests PASS |
| GREEN | `fd371bf`; [green.log](green.log): all boundary checks PASS |
| Reproduce | `node ci/action-gate.test.js`; `node ci/mechanism-2aa-codex-action-gate-policy.test.js`; `node ci/mechanism-task-git-authorization.test.js` |
| Package | `npm run plugin:sync`; canonical/package action gate byte comparison and identical lifecycle tests |
| Final core | `c170a96cf856295200d2d1a62c15a552c3cb2b37` |
| Full regression | [Node 24 full run](verification.md): 13 PASS, 0 FAIL, 3 UNCHECKED (local Node 22 lanes); exit 0 |
| Reviewer routing | `spawn_agent`: `fork_turns=none`, `model=gpt-6-luna`, `reasoning_effort=xhigh`; host-issued model identity/effort attestation is not exposed |
| Independent review | [Luna cold review](luna-review.md): core PASS at `c170a96`; 1 BLOCKER + 2 MAJOR fixed and independently rechecked; no open code BLOCKER/MAJOR |
| Candidate live Host | UNCHECKED: current session loads immutable installed runtime `0.42.0-f51078676b56`, not this candidate; no hook/trust configuration changed |

## Original rejection provenance

- Observed 2026-10-26T01:12:15.045Z; session `01a175b3-4583-7590-9c9d-f71a9439ae8e`, tool call `exec-8e76e1be-e5a3-493d-807b-2ad6cdbc7c31`.
- Actual tool: `mcp__codex_apps__github__update_pull_request`; arguments: `repository_full_name`, `pr_number: 376`, `body` only.
- Audit: `structured-mutate`, `mutate`/`gated`, host `codex`, `rejected`, reason `host-ask-decision-unverified-or-unsupported`.
- Recomputed from the original transcript CommandExecution output at 2026-10-26T01:12:14.917Z (1,840 characters): MATCH. The temporary body file changed later and is not used as original evidence.
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


## Independent review corrections and replay

| Finding | RED evidence | Fix / GREEN evidence |
| --- | --- | --- |
| Earlier optional hint masked required hint | `1e77c26`, [9 failures](review-hints-red.log) | `ff796c9`, [PASS](review-hints-green.log) |
| Exact Codex PR mutation downgraded by read/unknown descriptor | `06a66c2`, [11 failures](review-descriptor-red.log) | `e9344de`, [PASS](review-descriptor-green.log) |
| MCP update disguised as shell family | `16f5e20`, [14 failures](review-family-red.log) | `c170a96`, [PASS](review-family-green.log) |

- Conflicting-hint precedence now preserves any required hint across all supported envelopes. Ordinary PR creation controls are unchanged; contradictory required hints honor the existing required-Gate contract.
- Exact-update descriptor/family hardening is Codex-only. Other hosts keep their prior descriptor behavior; higher-risk Codex descriptors remain gated.
- Initial RED/GREEN runs used Node 26.12.1 in the sibling-worktree shell; Luna independently replayed original RED under Node 24.22.1. Correction RED/GREEN and final regression use explicit Node 24 PATH.
- Earlier full runs were superseded, never claimed complete: Node 26 reached 128-suite self-regression PASS before stopping during mutations; the first Node 24 run stopped for the descriptor/family review correction.

Reproduce the independently authored checks from the repository root (Node 24):

```sh
node benchmarks/results/codex-pr-metadata-2026-10-26/luna-action-family-cross-product.js .
node benchmarks/results/codex-pr-metadata-2026-10-26/luna-codex-action-gate-prehook-smoke.js .
```

- [Cross-product log](luna-action-family-cross-product.log): 2,709 cases, 4,729 assertions, 0 failures.
- [Stdin smoke log](luna-codex-action-gate-prehook-smoke.log): seven actual pre-hook subprocess cases PASS, covering host deferral and rejected cases with persisted audit fields.
- These are deterministic mechanism evidence, not live Codex Host evidence.


## Controlled GitHub delivery probe

- Draft [PR #377](https://github.com/dyphn1/Harness-everything/pull/377) was created via the normal GitHub MCP create path (no merge).
- The same body was then submitted via normal `github_update_pull_request`, with only repository_full_name/pr_number/body. The installed old runtime rejected it before execution as `structured-mutate`.
- [Preserved live rejection](live-installed-runtime-rejection.json) binds the attempted body to its payload hash and installed rule-table provenance. No alternate PR edit path was used after rejection; the PR body was not changed by this probe.
- This is live evidence of the installed old version's rejection, not candidate live PASS. Candidate update/title/body and comment lifecycle live-host execution remain UNCHECKED; no comment-operation exemption was added.
- CI: [initial PR workflow](https://github.com/dyphn1/Harness-everything/actions/runs/40275422862); final HEAD status must be checked separately after evidence commits.
