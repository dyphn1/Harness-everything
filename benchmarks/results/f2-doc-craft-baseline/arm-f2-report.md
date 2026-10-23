# F2-P report — opening paragraph of `docs/doc-workflow-reconciliation.md`

## 1. Files read (in order)

1. `<repo>/.worktrees/packets/feat-path/F2-P-f2-task.md`
2. `<paired>/arm-f2/harness-everything/SKILL.md`
3. `<paired>/arm-f2/docs/doc-workflow-reconciliation.md`
4. `<paired>/arm-f2/AGENTS.md`
5. `<paired>/arm-f2/harness-everything/references/triage-and-tiers.md`
6. `<paired>/arm-f2/harness-everything/references/doc-check.md`
7. `<paired>/arm-f2/harness-everything/references/documentation/_shared/writing-craft.md`
8. `<paired>/arm-f2/.agents/harness-everything/project-docs.json`

## 2. Paragraph before / after (verbatim)

Before:

```
**Status: S1 runtime ships default OFF; opt in with `HARNESS_DOC_RECONCILIATION_PILOT=1`.
S1 grants no positive document verification credit. S2/S3 are pending; E1 has not started.**
This document refines the [document lifecycle contract](document-lifecycle.md#phase-3b--narrow-integration-contract-s1-shipped-default-off-positive-reconciliation-not-shipped).
The [accepted E0](https://github.com/dyphn1/Harness-everything/issues/341#issuecomment-6308604128)
permits this limited, reversible consumer under the
[owner's E0/E1 decision](https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6283237637).
Current evidence establishes deterministic mechanism/package behavior, not live-host loading or E1 GO.
```

After:

```
**Status: the S1 runtime documented here is a temporary, no-credit Phase 3b slice that
ships default OFF. To opt in, set `HARNESS_DOC_RECONCILIATION_PILOT=1`.
S1 grants no positive document verification credit. S2/S3 are pending; E1 has not started.**
This document refines the [document lifecycle contract](document-lifecycle.md#phase-3b--narrow-integration-contract-s1-shipped-default-off-positive-reconciliation-not-shipped)
by adding a limited, reversible consumer of that contract.
The [accepted E0](https://github.com/dyphn1/Harness-everything/issues/341#issuecomment-6308604128)
permits that consumer under the
[owner's E0/E1 decision](https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6283237637).
Current evidence establishes deterministic mechanism/package behavior, not live-host loading or E1 GO.
```

All three links, the anchor (including its URL fragment), the frontmatter, and every factual/contract claim are preserved. The rest of the file was not touched. The only additions ("temporary", "no-credit", "Phase 3b", sentence splits, the explicit "consumer of that contract") are restatements of claims already in the document (e.g. "S1 is a temporary negative-credit slice", "Phase 3b", "preserve the checker's current envelope boundary" sections).

## 3. Check run

Per doc-check.md ("Use an absolute workspace path"), run once from the workspace root. `--base` is omitted because the packet forbids git commands, so the output records `evidence.immutability: not-observed` as the guidance anticipates.

Command:

```
node "<paired>/arm-f2/harness-everything/scripts/doc-check.js" check \
  --workspace "<paired>/arm-f2" \
  --config .agents/harness-everything/project-docs.json \
  --changed-path "docs/doc-workflow-reconciliation.md"
```

Exit code: `0`

Full stdout:

```text
{
  "lint": {
    "exit": 0,
    "evidence": {
      "immutability": "not-observed"
    },
    "diagnostics": []
  },
  "links": {
    "checked": 10,
    "broken": []
  },
  "coverage": {
    "unsupported": [
      {
        "reason": "no domains declared; bare <DOMAIN>-NNN references are not checked"
      }
    ]
  },
  "reminders": [
    {
      "code": "prose-share",
      "path": "docs/doc-workflow-reconciliation.md",
      "strength": "SHOULD",
      "proseLines": 559,
      "eligibleLines": 721,
      "share": 0.7753120665742025,
      "threshold": 0.5
    }
  ]
}
```

Notes (not caused by my edit, not fixed):

- `coverage.unsupported` reports that the config declares no `domains`, so bare `<DOMAIN>-NNN` references are not checked; this is a config property that existed before the edit.
- The `prose-share` reminder is advisory (`strength: "SHOULD"`) per writing-craft.md; the doc already exceeded the threshold before the edit, and the task forbids restructuring. Dismissed by reading; exit code unchanged.

## 4. Guidance followed (and the files that instructed it)

1. `arm-f2/harness-everything/SKILL.md` — invariants to route the work and verify with objective evidence ("Verify (MUST)"); its deep dive pointer to `references/triage-and-tiers.md`.
2. `arm-f2/harness-everything/references/triage-and-tiers.md` — the Governed-doc check: "any edit to a file governed by `.agents/harness-everything/project-docs.json` runs the editorial check in doc-check.md: lifecycle lint plus local link targets."
3. `arm-f2/harness-everything/references/doc-check.md` — the exact check command, its output/exit-code contract, that a reminder is a SHOULD dismissed by reading, and to record the full command, exit code, stdout, and whether `coverage.unsupported` is empty.
4. `arm-f2/harness-everything/references/documentation/_shared/writing-craft.md` — read before editing a governed doc (per doc-check.md): one idea per sentence, prose ≤ 3 sentences per paragraph, the prose-share reminder rules.
5. `arm-f2/.agents/harness-everything/project-docs.json` — confirmed `docs/doc-workflow-reconciliation.md` is governed (`role: reference`), so the check MUST run.

Because of this guidance I rewrote the paragraph with one idea per sentence (writing-craft.md), confirmed the doc is governed (project-docs.json), and ran `doc-check.js` with the workspace, governed-config and changed path exactly as doc-check.md prescribes; nothing the check reported was caused by my edit, so nothing further needed fixing.

STATUS: DONE
