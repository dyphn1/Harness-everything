# OpenCode D1/D2 live-host observations — 2026-10-25

**Retained negative observations only.** These attempts do not demonstrate a completed task, successful enforcement, or behavioral effectiveness.

## Run record

| Run | Product / fixture baseline | Requested model | Captured result |
|---|---|---|---|
| D1 | `37c97046`; fixture `f486e57d` | `opencode/beam-free#default` | Sanitized export records `failed` with direct error type `provider.free-limit`. Shell pipeline exit `1`; OpenCode process exit **UNKNOWN**; sanitized export exit `0`. |
| D2 | `37c97046`; fixture `39aa0898` | `nvidia/deepseek-ai/deepseek-v4.1-flash` | Process exit `1`, signal `null`, timeout `false`, spawn failure `null`. One filtered stdout event had `type=error` and no session ID; stderr was `0` bytes. Session existence, provider-request status, and cause are **UNKNOWN**. |

The user requested switching from the exhausted free quota to NVIDIA; one D2 invocation was attempted. NVIDIA's catalog listing and configured-auth-presence boolean came only from non-session preflight. The model variant was not shown. D2's filtered error omitted its discriminant, so its cause is unknown; this is not evidence of an NVIDIA outage.

## Setup and retained evidence

Both commands used `opencode run --standalone --format json` and process-local `XDG_CONFIG_HOME`, `OPENCODE_CONFIG_DIR`, `HARNESS_STATE_HOME`, `HARNESS_DOC_RECONCILIATION_PILOT=1`, and `HARNESS_D1_TRACE_FILE`. D1 used the beam-free model above; D2 requested the NVIDIA model above. No user-global credentials or configuration were changed.

| Observation | D1 | D2 |
|---|---|---|
| Fixture | Commit clean before/after; ADR hash unchanged | Commit clean before/after; ADR hash unchanged |
| Natural completion | Not observed | Not observed |
| Observer | Load marker and trace absent | Trace absent; observer load **not observed** |
| Refusal/report | No pilot report | Report capture **UNKNOWN**; no session ID was available for lookup |
| Global Harness absence | **UNCHECKED** | **UNCHECKED** |

The sanitized D1 export is not copied into this record; its SHA-256 is retained in [`evidence.json`](evidence.json). D2 raw stdout/stderr were not retained; only allowlisted metadata and hashes remain. `LOCAL_ONLY` source paths in `evidence.json` identify supporting packets and artifacts that are not shipped in this PR. The D2 runner and its exit/timeout self-check are also local-only; their self-check is deterministic mechanism evidence, not live-host evidence. This PR does not make the full runs publicly reproducible.

## Interpretation

Neither negative attempt qualifies as an E1 cycle or supports E1 GO, benefit, qualification, or promotion. D1 stopped on the free-provider limit. D2 returned an error event without a session ID; no cause or provider request can be established from retained metadata. This PR preserves negative observations only.
