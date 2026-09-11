# Integration Testing Profile

Use `testProfile: "integration"` when behavior crosses a process, filesystem, database, network, queue, subprocess, or service boundary.

## Required evidence

- Derive every expectation from the exact authoritative section, or record `INFERRED` and its basis.
- Exercise positive and negative boundary contracts, complete request/input validation, response/output schema and values, declared errors, cleanup/rollback, and applicable malformed or unsupported inputs.
- Run identical input at least twice from clean equivalent state.
- Compare exit status, error category, output, created/changed/deleted files, persistent state, events, logs, and external calls. Preserve specified ordering.
- Treat every mismatch as failure. Normalize only an `output.*` or `sideEffects.*` field whose variability is explicitly permitted by a cited authoritative section.

Use the narrowest real boundary that proves the contract. Do not replace the boundary with a mock and still call the result integration evidence. See [interface design](../guides/interface-design.md) and [deep-module guidance](../guides/deep-modules.md).
