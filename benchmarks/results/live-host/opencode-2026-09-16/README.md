# Live-host evidence — Harness opencode plugin (session: ses_f5520f1d9ffeB8KLTIUKgA5ng8)

This is **limited mechanism/live-host evidence**, not a BENCHMARK_SOP
behavioral scenario or evidence of behavioral effectiveness. It records
plugin loading and enforcement-state observations from a real OpenCode host.
No raw full session transcript or blocked-tool trace is retained. The saved
state is a **post-reset snapshot**, not a history of the enforcement chain;
earlier interactive observations and agent reports are distinguished below.

- date: 2026-09-16
- engine: opencode 1.18.31 (macOS, Node v24.14.1)
- model: opencode/union-alpha
- plugin source: `opencode-plugin/index.mjs` at repo revision `dc3ea80` (0.5.2)
- installed as: `<sandbox>/.opencode/plugins/harness-enforcement.js`
  (copy of `index.mjs`, extension renamed — see "Filename finding")
- sandbox workspace: throwaway git repo with `package.json` script
  `"test": "node test.js"` where `test.js` is an intentional `process.exit(1)`
  fixture, so `npm test` fails deterministically.
- prompt pattern: "Create/append hello.txt … Do not run any tests." — the
  agent was explicitly told NOT to run tests. That instruction alone does not
  establish who executed verification; the evidence below is plugin state
  and reported interactive observations.

## Filename finding (install-surface caveat)

`.opencode/plugins/*.mjs` is **not loaded** by opencode 1.18.31. Only
`*.js` / `*.ts` files are auto-discovered, matching the official plugin docs
("Place JavaScript or TypeScript files in the plugin directory"). A control
probe confirmed the negative direction; the positive direction shows
discovery and events only:

- probe installed as `zz-probe.mjs` → factory import, factory call, and every
  hook were silently absent.
- identical probe installed as `zz-probe.js` → `factory-import`,
  `factory-called`, `event:session.created`, and `event:session.idle` all
  fired. No tools were invoked in that PONG6 probe session, so the log
  contains **no** `tool.execute.before/after` lines. The probe does not
  demonstrate tool hooks or edit blocking.

Consequence: the README installation command
(`cp index.mjs .opencode/plugins/harness-enforcement.mjs`) silently no-ops on
this host version. The enforcement chain below was only reachable after
renaming the copy to `.js`. Tracked as a follow-up issue; do not read this
artifact as validating the `.mjs` installation path.

## Session observations and retained evidence

The sequence below combines prior interactive tool output with the final
post-reset snapshot. Intermediate states were not preserved as separate
snapshots; items marked "reported" rest on interactive output or agent
claims, not on retained artifacts.

1. **Edit tracking — plugin state appeared.**
   After the agent wrote `hello.txt` (having been told not to run tests),
   plugin state appeared at
   `~/.agents/harness-everything/workspaces/harness-live-test-a8d00c4b7672/state/sessions/ses_f5520f1d9ffeB8KLTIUKgA5ng8/`:
   `edit-state.json` with `verificationPending: true`. The snapshot now shows
   `editsSinceVerification: 4`; the earlier value of 1 was an
   interactive observation, not a preserved snapshot.

2. **`session.idle` verification gate — breaker failure recorded.**
   With verification pending, the plugin ran the workspace scripts from
   the host process. `circuit-breaker.json` recorded the failure signature
   `"npm test: > harness-live-sandbox@1.0.0 test > node test.js"`. The
   snapshot shows `count: 1` and `hardLock: false`.

3. **Follow-up nudge reported delivered through the SDK.**
   `edit-state.json` showed `followUpPending: true` with
   `followUpDeliveryPending: false` and `lastFollowUpError: null`. This is
   state evidence that a follow-up was queued and a delivery attempt recorded
   no error; a raw session transcript was not retained.

4. **Rule of 3 → forced reflection (operator-seeded).**
   Two more same-signature verification failures across `--continue` turns
   raised the failure count to 3. State:
   `reflectionPending: true`, a `reflectionToken` was minted
   (`3fe402d5f67643c1bdd28b741039268f`), and the forced-reflection prompt was
   pushed into the session. The reflection was **manually seeded by the
   operator first**; the agent then rewrote the report (all five required
   sections, `RESUME:` decision, correct token). This is not an unaided
   agent reflection and is not claimed as one.

5. **Post-reflection repeat — hard lock reported.**
   Prior interactive output showed the same signature failing again after
   the reflection was recorded with `hardLock: true` and
   `lastReflectionSignature` matching the failure signature. **The preserved
   snapshot is POST RESET**: `hardLock: false`, failure `count: 1`. The
   hard-lock state itself is therefore an interactive observation, not a
   preserved snapshot.

6. **Reset; agent-controlled, not proven durable enforcement.**
   The v7 agent reported that a breaker blocked it and that it then deleted
   the session state file and appended. No retained blocked-tool trace
   independently evidences the blocking, and the reset path is
   agent-controlled: this demonstrates an enforcement limitation (state-file
   deletion resets the breaker), **not** proof of durable hard enforcement.
   Final compliance counters:
   `totalEdits: 7, verifiedEdits: 1, circuitBreakerTrips: 2, reflectionsForced: 1`.

## Preserved artifacts

Raw state files are preserved unmodified under
`benchmarks/results/live-host/opencode-2026-09-16/`:

- `state/sessions/ses_f5520f1d9ffeB8KLTIUKgA5ng8/circuit-breaker.json`
- `state/sessions/ses_f5520f1d9ffeB8KLTIUKgA5ng8/edit-state.json`
- `state/sessions/ses_f5520f1d9ffeB8KLTIUKgA5ng8/compliance.json`
- `state/sessions/ses_f5520f1d9ffeB8KLTIUKgA5ng8/zoom-out-report.md`
- `probe-control.md` — the `.mjs`/`.js` loading control experiment
- `run-commands.md` — reconstructed command list, not a verbatim log

Limitations of the preserved record: there is no raw full session
transcript, no preserved hard-lock snapshot, and no blocked-tool trace.
No claim is made here about behavioral effectiveness.

## Evidence-level classification

| Mechanism | Level |
|---|---|
| Plugin discovery + factory invocation + session events | **Live verified** (`.js` filename only, PONG6 probe; no tool hooks exercised) |
| Edit-tracking state writes (`edit-state.json`) | **Live verified** (snapshot values are post-reset) |
| Breaker failure recording on `session.idle` verification | **Live verified** for state effect; snapshot is post-reset (`hardLock: false`, `count: 1`) |
| SDK follow-up nudge | **Reported** (state fields consistent; no transcript retained) |
| Rule-of-3 forced reflection | **Live verified as mechanism** (token minted); report was operator-seeded, then agent-rewritten — **not** unaided reflection |
| Hard lock + edit blocking | **Reported only** (interactive observation; no retained blocked-tool trace; post-reset snapshot shows `hardLock: false`) |
| Reset-by-state-file-deletion | **Reported/state-consistent** (no deletion trace retained; implementation permits agent-controlled reset, not durable enforcement) |
| `.mjs` filename installation path | **Broken** on 1.18.31 (probe evidence above) |

This is still single-host, single-model, single-session evidence. It does not
prove npm-package installation, global-scope loading, or behavior on other
opencode versions; those remain `Unknown`/mechanism-only. It also makes no
behavioral-effectiveness claim: no raw full session transcript was retained,
and the preserved state cannot reconstruct the enforcement sequence.
