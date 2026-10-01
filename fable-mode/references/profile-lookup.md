# Profile lookup

Use for explanation or a profile-only JSON record. No stage, audit-log mutation, delegation, or model switch is implied. Execution requests retain their selected workflow obligations.

| Alias | Profile | Role | Named agent |
|---|---|---|---|
| haiku | mechanical | mechanical-worker | fable-worker-haiku |
| sonnet / sonnect | reasoning | reasoning-worker | fable-worker-sonnet |
| opus | orchestrator | orchestrator | fable-orchestrator |

Preserve the input alias. Profiles describe behavior; the host chooses the actual runtime model. Report runtime fields as unknown when they were not supplied; never infer a model from an alias. Runtime floors are advisory, including unknown or below-recommended results.

For a lookup, these fields suffice: `requestedProfile`, `effectiveProfile`, `profileAlias`, `assignedRole`, `runtimeModel`, `runtimeEffort`. If the user requests a computed floor comparison, read the relevant entry in `runtime-model-floor-matrix.json` and the resolution rules in [runtime-floor rules](model-matrix.md); use `scripts/model-selector.js` for a stage audit, not by reading its implementation for a lookup.

Example for `fable on sonnect` with no supplied runtime:

```json
{"requestedProfile":"reasoning","effectiveProfile":"reasoning","profileAlias":"sonnect","assignedRole":"reasoning-worker","runtimeModel":null,"runtimeEffort":null}
```
