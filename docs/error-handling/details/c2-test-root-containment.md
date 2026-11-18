# C2 — Level 3 test-root containment contract

## Decision

The cycle-import test's `isOutside(root, candidate, pathApi)` computes `relative = pathApi.relative(root, candidate)`. A candidate is outside when the relative result is absolute, is exactly `..`, or starts with `..` followed by that path API's separator. This recognizes parent escapes without mistaking an in-root name such as `..cache` for a parent segment.

On Windows, paths on different drives make `path.win32.relative` return an absolute path. A prefix-only `relative.startsWith('..')` check therefore accepts the cross-drive path as inside. A string-prefix check on the candidate also accepts a sibling such as `D:\repo-other` as inside `D:\repo`.

## Deterministic boundary matrix

The test uses a GitHub runner-style root; the table abbreviates it to `D:\repo`.

| Root | Candidate | Expected `isOutside` | Boundary exercised |
| --- | --- | --- | --- |
| `D:\repo` | `D:\repo\ci` | `false` | Ordinary root child stays inside. |
| `D:\repo` | `D:\repo\..cache` | `false` | A child name beginning with two dots is not a parent segment. |
| `D:\repo` | `D:\repo-other` | `true` | Similar-prefix sibling stays outside; `candidate.startsWith(root)` is insufficient. |
| `D:\repo` | `D:\` | `true` | Parent escape stays outside. |
| `D:\repo` | `C:\Users\runner\AppData\Local\Temp\fixture` | `true` | Cross-drive result is absolute; the old prefix-only check misses it. |

These Windows cases use `path.win32`, so their semantics are exercised on non-Windows hosts too. The cycle-import fixture continues to check its real temporary directory with the host's default `path` API.

## Verification

```sh
node --test ci/mechanism-397-cycle-import.test.js
```

A passing local test is deterministic mechanism evidence. The test does not establish a hosted Windows run; the repository's Windows CI lane provides that host evidence.

## Provenance

- [E-0019: Windows cross-drive relative paths](../../../.agents/harness-everything/errors/E-0019-windows-cross-drive-relative-path.md)
- [C2 action map](../actions/c2-action-map.md)
- [Cycle-import mechanism test](../../../ci/mechanism-397-cycle-import.test.js)
