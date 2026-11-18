# C7 — Path-level packet write-set check

This detail implements the C7 action in [the action map](../actions/c7-action-map.md). It checks whether a candidate slice stayed inside a packet's approved path set, including generated files and uncommitted output.

The checker selects the target repository with `git rev-parse --show-toplevel` from its current working directory. Its own file may live in another checkout; reported paths are relative to the selected repository.

## Command

```sh
node scripts/check-packet-write-set.js --base BASE_SHA [--head HEAD_REV] --allow PATH_OR_GLOB... [--allow-file FILE]
```

| Option | Contract |
| --- | --- |
| `--base` | Required pinned commit for the candidate comparison. |
| `--head` | Optional commit or ref; defaults to the selected repository's `HEAD`. |
| `--allow` | Repeatable repository-relative path or glob. |
| `--allow-file` | Optional newline-delimited path/glob list, relative to the invocation directory; empty lines are ignored and CRLF is accepted. |

At least one `--allow` or a non-empty `--allow-file` is required. Allow-file lines are patterns as written; `#` is not a comment marker. Use `/` between path segments on every platform.

Quote glob patterns in shell invocations so the shell passes them to the checker unchanged.

## Paths examined

```mermaid
flowchart LR
    TREE["Base-to-head tree diff"] --> UNION["Deduplicate repository-relative paths"]
    MODE{"--head omitted<br/>or resolves to HEAD?"} -->|yes| STAGED["Staged changes against HEAD"]
    MODE -->|yes| UNSTAGED["Unstaged changes"]
    MODE -->|yes| NEW["Non-ignored untracked paths"]
    MODE -->|no| UNION
    STAGED --> UNION
    UNSTAGED --> UNION
    NEW --> UNION
    UNION --> MATCH["Match each path against every allow pattern"]
    MATCH --> OUT["Print one JSON-quoted ALLOWED or OUT_OF_SET line per path"]
```

When `--head` is omitted or resolves to the selected repository's current `HEAD`, the checker includes staged, unstaged and non-ignored untracked paths. When `--head` resolves to another commit, it compares only the base-to-head commits, excludes all working-tree changes, and prints `Comparison: commits only (--head is not the current HEAD).`

The tree comparisons use `git diff --no-renames`; a move therefore contributes both its old and new path. The staged check also disables rename detection. Ignored untracked files are excluded according to Git's ignore rules. Paths are deduplicated and sorted before output, and JSON quoting keeps spaces, tabs and newlines on one output line.

Patterns match the entire Git-style path (slash separators): `*` matches any characters except `/`, `?` matches one character except `/`, and `**` matches across path segments. `**/` also matches zero directory segments. For example, `docs/**` matches `docs/guide.md` but not `docs-extra/guide.md`.

## Results and limits

| Exit | Meaning |
| --- | --- |
| `0` | Every observed path matched an allow pattern. |
| `1` | At least one `OUT_OF_SET` path needs disposition. |
| `2` | Usage, allow-file, revision or Git error; no scope result was established. |

The checker reads Git state with optional Git locks disabled; it does not stage, reset, clean, checkout or write repository files. A valid but incorrect base/head can still produce a misleading comparison, so the coordinator supplies the approved pinned revisions. Exit 0 says nothing about changes inside an allowed file: same-file content loss and omissions from an approved outline remain review obligations.
