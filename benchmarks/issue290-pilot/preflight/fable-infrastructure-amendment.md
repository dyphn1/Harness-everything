# Linked-fixture infrastructure diagnosis — 2026-10-14

The first four Claude Fable launches exited before model execution with
`Settings file not found: .../hook-settings.json`. None emitted UserPromptSubmit,
model usage, or router attribution. They are infrastructure/inconclusive rows,
not four model failures. All are retained without selective removal.

Read-only root-cause reconstruction: run.py prepares and commits fixture files,
then writes hook-settings.json. A new linked Git worktree receives only the
committed snapshot. Codex passes its hooks inline, but Claude requires the
missing settings file. The original linked-fixture preflight checked Git linkage
and source presence without asserting this host-specific startup prerequisite.
The unattended supplement also failed to stop on absent router attribution.

After these repeated same-signature setup failures, stop edits, reconstruct the
full setup path, and record this diagnosis before recovery. Add a failing
fixture prerequisite test, copy the identical settings into the linked checkout,
assert all required launch files exist, and stop immediately on absent initial
router attribution. The original script/hash is preserved as v1.

One symmetric infrastructure retry for the two Claude pairs is registered
before any retry model call: AB then BA, identical prompt/model/effort/documents,
tests, budgets and canonical Harness revision. The four original startup errors
remain outside the behavioral denominator. No Luna outcome is rerun, and no
valid agent failure is excluded. The same original 7,200 agent wall-second and
500,000 output-token budgets include original + retry attempts. No higher limit
or additional outcome-selected repeat is introduced.
