# Unit Testing Profile

Use `testProfile: "unit"` when the behavior remains inside one process and has no real filesystem, database, network, queue, subprocess, or service boundary.

## Required evidence

- Derive expected behavior from the exact authoritative section, or record `INFERRED` and its basis.
- Cover every supported and rejected equivalence partition exposed by the unit.
- Validate applicable required/optional/omitted/empty/null/min/max/boundary inputs.
- Assert output value, type, schema/shape, required and prohibited fields, and absence of side effects where applicable.
- Test each declared error type/code/message and cleanup guarantee; mark a whole dimension N/A only when the unit has no such contract.
- Cover malformed, unknown, extra, unsupported, out-of-range, duplicate, and wrong-type inputs only where the unit accepts that input class. Record reasoned N/A for the rest.
- Mark integration determinism N/A with a reason. Ordinary repeatability remains the project test runner's responsibility.

Test observable behavior through the public interface. Use [tests guidance](../guides/tests.md) and [mocking guidance](../guides/mocking.md); isolate external boundaries instead of selecting this profile for code that actually crosses them.
