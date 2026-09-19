# Contract Protection Adapters

This directory does **not** claim generic mutation-testing support.

## Supported in Phase 3

### `node-npm-v1`

Supported project shape:

- Node.js project with a `package.json`;
- one explicitly selected npm script used as the contract-test command;
- **zero external npm dependencies** for this first adapter revision;
- probes are predeclared in a local JSON plan and tied to stable `REQ-*` IDs and authoritative source sections;
- every baseline and probe run executes in a fresh temporary copy; the source workspace is never mutated.

Source workspaces containing symbolic-link or junction entries are rejected before project code runs. The v1 adapter does not claim isolation when a copied path could retain an external filesystem target.

Supported probe strategies:

1. **`env`** — explicit project-owned fault injection via environment variables.
2. **`replace`** — exact one-occurrence text replacement in the isolated copy only. This is the fallback when the project has no built-in fault-injection seam.

A probe is `KILLED` only when the selected npm script fails **and** its output contains the predeclared requirement-specific observable marker. A green run is `SURVIVED`. Timeout/spawn failures, baseline failures, unsafe/ambiguous replacement, missing dependencies, or unrelated failures are `NOT_EVALUATED` / `INVALID`; none of those earn protection credit.

The adapter does not install dependencies, access the network, infer mutation locations, rewrite source documents, or commit generated probes.

## Not yet supported

- arbitrary Jest/Vitest/Mocha/Pytest/Go/Rust/.NET adapter discovery;
- projects that require dependency installation inside the isolated copy;
- automatic source-derived mutation synthesis;
- compiler-failure-as-kill;
- flaky-test attribution;
- dirty-worktree mutation or in-place production changes.

Those remain future adapters/slices. Phase 3 intentionally proves one narrow real runner plus an explicit isolated fault-injection fallback.
