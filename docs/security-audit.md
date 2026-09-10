# Security Audit: Verifier Boundaries

Date: 2026-09-10

## Scope

The audit covers `scripts/lib/path-boundary.js` and
`scripts/lib/execution-contract.js`, which are shared by later verifier,
workspace, installer, and plugin fixes.

## STRIDE and abuse cases

| Threat | Abuse case | Boundary |
|---|---|---|
| Tampering | A junction or symlink below an output root redirects a new file outside it. | Resolve the deepest existing ancestor and reject link components below the root. |
| Tampering | `..` or an absolute patch path escapes the repository allowlist. | Normalize repository-relative paths and reject traversal/absolute paths. |
| Information disclosure | A verifier treats a path fragment as proof that a different command ran. | Compare the complete normalized command or exact argv. |
| Elevation of privilege | A mixed patch includes one allowed file and one unrelated file. | Require every parsed patch path to be authorized; reject the entire patch otherwise. |
| Repudiation | A caller cannot distinguish an outside path from a link alias. | Stable error codes identify the rejected boundary condition. |

## Residual risks

- Callers must still use the returned physical target and perform the check
  immediately before the filesystem operation; a check done earlier can be
  invalidated by a time-of-check/time-of-use race.
- The helper does not grant permission to choose a boundary root. Consumers
  must establish that the root itself is trusted before calling it.
- Live model behavioral evidence remains an environment/acceptance concern and
  is not manufactured by these deterministic helpers.

## Verification

`ci/mechanism-2v-verifier-boundaries.test.js` covers normal paths, traversal,
junction/symlink escapes, missing leaves, Windows casing, exact commands, and
all-or-nothing patch authorization.
