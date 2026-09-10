# Verifier Boundary Contracts

This repository handles paths and execution evidence produced by local agent
sessions. Consumers must use these contracts before writing, deleting, or
grading anything derived from a session.

## Physical path containment

```js
const { assertContainedPath } = require('../scripts/lib/path-boundary');

const { target } = assertContainedPath(outputRoot, requestedPath);
```

`assertContainedPath()` resolves the deepest existing ancestor before appending
missing segments. It rejects lexical traversal, junction/symlink components
below the selected root, and physical paths outside the root. Call it for the
final target, not only for the user-provided parent directory. Consumers must
handle `PATH_OUTSIDE_BOUNDARY`, `LINK_COMPONENT_IN_BOUNDARY`, and
`INVALID_PATH` as hard failures.

## Exact execution evidence

Use `commandsEqual()` for command expectations. String commands compare after
whitespace normalization; argv arrays compare each argument and length exactly.
Substring checks are not valid evidence.

Use `extractPatchPaths()` and `patchPathsAuthorized()` for patch-shaped tool
output. A patch is authorized only when every touched path is allowlisted;
mixed authorized and unauthorized patches must be rejected atomically.

Prefer structured argv and patch metadata when the producer provides them.
These string fallbacks intentionally fail closed rather than guessing intent.
