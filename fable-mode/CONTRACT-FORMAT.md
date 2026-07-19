# Stage Contract Format

Stage contracts live in `.harness/contracts/` and make fable-orchestrator's
"re-run or spot-check every stage's named check" discipline auditable instead
of a verbal claim. The `contract-test.js` hook (PostToolUse: Bash) watches for
the exact `checkCommand` running and fills in the result — you write the
contract, the hook resolves it.

## When to write one

Right before you (the orchestrator) run the Bash command that re-verifies a
stage's pass condition — one contract per stage, filed the moment you're about
to spot-check it. Not for every Bash call, only the ones that *are* the named
check.

## File

`.harness/contracts/<stageId>.json`, created lazily. `stageId` is whatever you
numbered the stage in your stage map (`stage-3`, `db-migration`, etc).

## Schema

```json
{
  "stageId": "stage-3",
  "agent": "fable-worker-sonnet",
  "task": "one-line description of what the worker was assigned",
  "outputPath": "path to the artifact the worker produced",
  "checkCommand": "the exact shell command you are about to run to verify it",
  "status": "pending"
}
```

Write it with `status: "pending"` and the *exact* `checkCommand` string you're
about to run — the hook matches verbatim, not fuzzily. Then run that command.
The hook fills in `status` (`pass`/`fail`), `evidence` (tail of the command's
output), and `verifiedAt` for you; you don't write those fields yourself.

## Reading contracts back

Before delivering, `Read` (or `Grep status` across) `.harness/contracts/*.json`.
Any file still `"status": "pending"` means the named check was declared but
never actually run — that stage's output hasn't been verified, whatever the
worker's report claimed. Resolve it before building further on that stage.

## Not a blocking gate

The hook can only react after a Bash call finishes — it can't stop a bad stage
from being built on in real time. It surfaces a failed check loudly (fed back
to you immediately after the command runs), but the actual discipline is still
yours: don't build on a stage whose contract is `pending` or `fail`.
