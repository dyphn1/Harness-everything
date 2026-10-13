# Live-host evidence: Codex CLI observation capture

This records live dispatch of the Codex user-hook compatibility fallback on one Windows host. It is mechanism/live-host evidence for turn capture, not a behavioral-effectiveness benchmark and not evidence for native plugin-hook mounting.

- Date: 2026-10-13 UTC
- Host: Codex CLI 0.162.1; Windows `10.0.26200` x64; Node.js v24.18.0
- Repository revision under test: PR #305, `3f57b8b376bfd437c8cff6ddbe4ddbf036380198`
- Packaged compatibility runtime: version 0.30.9; SHA-256 `7f4e7801d9fdb7350072b01c91034cd28890dfe7190d143ec7760c85fd5a29df`, matching `plugins/harness-everything/`
- Compatibility status: files healthy; status command reports `configured-unverified` because it cannot read Codex trust state.

## Procedure

The Codex `/hooks` UI showed the observation handlers as new/untrusted. I reviewed and trusted only the `UserPromptSubmit` and `Stop` handlers named `Recording a local System One turn observation`. I did not trust all hooks. No trust bypass flag was used. The successful probes ran through `codex exec` with read-only sandboxing and no tool calls. A second turn resumed the same session.

Two preliminary attempts were not counted as passing evidence: before trust, a completed CLI turn produced no observation; a later argument-passed prompt lost JSON quotes in Windows `.cmd` argument handling and created an invalid-label record. The accepted run passed its prompt through stdin, preserving the valid JSON label. The probe prompt and raw rollout stay in the private local Codex/observation stores and are not committed here.

## Results

The sanitized snapshot is [observation-records.json](observation-records.json). Both records have `host: "codex"`, the same session ID, sequential `turn` values, distinct `turn_id` values, and the self-report expected for their own turn:

| Turn | Record ID | Turn ID | Self-report intent | Result |
|---:|---|---|---|---|
| 1 | `09ba6878d736e3f7183e7c3a` | `01a1338c-9727-7743-824d-92f8ceb51f00` | `test` | Passed |
| 2 | `81a4c3a35f7894653aaf9f64` | `01a1338f-6ea2-7671-997f-e9a205b96102` | `discuss` | Passed |

The second turn did not reuse the first turn's label. Prompt text, prompt hashes, and raw session content are omitted from this committed artifact. The live records showed zero tool calls, as expected for these reply-only probes; this run does not verify tool-event counting.

## Limits

- Verified scope: one Windows Codex CLI 0.162.1 setup using the user-hook compatibility fallback.
- Not verified: native plugin-bundled hook mounting, marketplace source reporting during `plugin-sync`, other Codex versions/platforms, other lifecycle events, or behavioral effectiveness.
- The CLI emitted a non-fatal GitHub MCP `AuthRequired` diagnostic and a bundled `SessionEnd` timeout-clamping notice. Both turns completed with exit code 0 and their observation records were present.

## Repository verification

All repository gates listed in `AGENTS.md` passed on this PR revision. The four gates affected by the new Codex evidence (`npm test`, `test:mechanism`, `test:consistency`, and `test:docs:capabilities`) initially exposed stale assertions that required Codex live evidence to remain `Unknown`; the assertions were updated to validate the retained artifact, then those gates passed on rerun.

| Gate | Result |
| --- | --- |
| `npm test` | Passed on rerun; 2 environment-dependent cases skipped |
| `npm run test:mutations` | Passed |
| `npm run test:mechanism` | Passed on rerun |
| `npm run test:consistency` | Passed on rerun |
| `npm run test:repo-contract` | Passed |
| `npm run test:docs:capabilities` | Passed on rerun |
| `npm run test:references` | Passed |
| `npm run test:release` | Passed |
| `npm run test:collision` | Passed |
| `npm run test:routing:skills` | Passed |
| `npm run test:routing:invariants` | Passed |
| `npm run test:plugin:openai` | Passed |
| `npm run test:plugin:submission` | Passed |
| `npm run test:platform:compatibility` | Passed on rerun |

The gates were invoked through `npm.cmd` in PowerShell because this host blocks the `npm.ps1` shim by execution policy. Waza was not installed, so optional Waza checks were unavailable.
