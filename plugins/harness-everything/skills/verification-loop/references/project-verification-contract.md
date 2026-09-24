# Project Verification Contract

Harness project verification has two layers:

1. **Declared contract** — `.harness/verify.json` is authoritative and executable.
2. **Read-only discovery** — ecosystem signals are reported as candidates when no contract exists. Detected candidates are never auto-run except the legacy `package.json` `lint` / `test` scripts.

This keeps verification explicit without turning discovery into an accidental command runner.

## Contract

Create `.harness/verify.json` at the enclosing Git repository root:

```json
{
  "version": 1,
  "roots": [".", "sub/a", "sub/b"],
  "checks": [
    {
      "id": "precommit",
      "run": "pre-commit run --all-files",
      "cwd": ".",
      "timeoutSec": 600
    },
    {
      "id": "sub-a-e2e",
      "run": "bash scripts/e2e.sh",
      "cwd": "sub/a",
      "timeoutSec": 600
    }
  ]
}
```

Rules:

- `version` MUST be `1`.
- `roots` is optional; default is `["."]`. Every root MUST stay inside the enclosing Git repository and exist.
- `checks` MUST be a non-empty array.
- Each check MUST have a unique non-empty `id`, non-empty `run`, repository-contained `cwd` (default `.`), and optional integer `timeoutSec` from 1 through 3600.
- Unknown fields, invalid JSON, duplicate IDs, escaping paths, or invalid values make verification `FAILED`.
- Contract checks run with `HARNESS_SKIP_PROJECT_CHECKS=1` so a project's checks cannot recursively invoke the same project gate.
- When a contract exists, ecosystem detection and legacy npm auto-run are not used.

A `git commit` is accepted as successful verification evidence only when:
- the declared contract contains a `pre-commit ...` check,
- a real pre-commit hook is configured for that repository, and
- the commit command does not use `--no-verify` or `-n`.

This prevents a generic commit from being mistaken for proof that the declared verification contract ran.

## Status taxonomy

| Status | Meaning | Exit |
|---|---|---:|
| `PASSED` | Every executed authoritative check exited 0. | 0 |
| `FAILED` | A check failed/timed out, the injected failure marker exists, or declared/project metadata is invalid. | 1 |
| `UNCHECKED_NO_CHECKS` | No contract, no runnable legacy npm checks, and no verification candidates were detected. | 0 |
| `UNCHECKED_DISCOVERED` | Verification candidates exist but at least one was not executed. | 0 |
| `SKIPPED` | `HARNESS_SKIP_PROJECT_CHECKS=1` recursion guard. | 0 |

Every `UNCHECKED_*` human report MUST include:

> PROHIBITED: Do NOT cite this run as proof that tests pass.

An exit code of 0 from `UNCHECKED_*` is non-blocking control flow, not passing-test evidence.

## Discovery when no contract exists

Discovery is read-only. Harness may report:

- `package.json`: `lint` / `test` remain legacy auto-run; `check`, `typecheck`, `verify` are candidates.
- `.pre-commit-config.yaml`: `pre-commit run --all-files`.
- `Makefile`: `test`, `check`, `lint`, `ci` targets.
- `justfile`: `test`, `check`, `ci` recipes.
- Python: pytest/ruff configuration in `pyproject.toml`, `tox.ini`, `noxfile.py`.
- `Cargo.toml`: `cargo test`.
- `go.mod`: `go test ./...`.
- `core.hooksPath`, `.husky/`, or `.git/hooks/pre-commit`: commit-time gate presence.

Detected commands are suggestions only. Their existence does not become pass evidence until they are explicitly run or declared in the contract.

## Multi-root behavior

With a contract, `roots` defines the verification scope. Each check is attributed to the most-specific declared root containing its `cwd`.

Without a contract, Harness reports the main Git root plus initialized submodule roots from `git submodule status --recursive`.

Overall status uses the most conservative root result:

```text
FAILED > UNCHECKED_DISCOVERED > UNCHECKED_NO_CHECKS > PASSED
```

A submodule with no checks remains visible as its own `UNCHECKED_NO_CHECKS` root; it is never silently merged into the parent result.

## Structured output

Run:

```bash
node harness-everything/scripts/verify-gate.js --json
```

The output contains:

- `status`, `reason`, and `repoRoot`
- `roots[]` with per-root status/reason
- `checks[]` with `id`, `run`, `cwd`, `source`, `exitCode`, and `durationMs`
- `candidates[]` with `source`, `run`, and `cwd`

The machine-readable result is evidence metadata; only `PASSED` means the gate produced passing verification evidence.
