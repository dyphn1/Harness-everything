# Workflow: Error Ledger Bootstrap

> Inventory local evidence for an existing repository and write only owner-approved ledger entries.

Detailed source privacy, classification, approval, promotion and Windows guidance lives in [the workflow reference](../../error-ledger-bootstrap/references/workflow.md).

```mermaid
flowchart TD
    SCAN["Read-only local scan"] --> CLASSIFY["Classify candidates locally"]
    CLASSIFY -->|"uncertain"| UNVERIFIED["Keep UNVERIFIED"]
    CLASSIFY -->|"supported candidate"| OWNER{"Owner approves this item?"}
    OWNER -->|"no"| LOCAL["Keep report local; do not write"]
    OWNER -->|"yes"| PREFLIGHT["Preflight trusted Harness checkout and dependencies"]
    PREFLIGHT --> PROMOTE["Promote the exact approved candidate"]
    PROMOTE --> INDEX["Regenerate the target index with --root"]
```

The oracle links candidates to ledger records by site-path overlap. In JSON,
`rates.unmatchedShare` is the unmatched candidate share; Markdown labels it
**unmatched candidate share (path overlap)**. This is a proxy and may link
distinct lessons, so it does not estimate semantic precision. Both recall rates
are path-linked proxies: `recall (all) = linked records / all records` and
`recall (comparable) = linked records / comparable records`.
