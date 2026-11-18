# C7 — Candidate write-set check

After a packet's local gates, the coordinator checks that the candidate slice stayed within its approved paths before accepting it. The checker reports path scope; the coordinator still reviews content and packet requirements.

```mermaid
flowchart TD
    GATES["Packet local gates complete"] --> RUN["Run checker with pinned base, candidate head and allow-list"]
    RUN --> EXIT{"Exit code"}
    EXIT -->|0| PATHS["Every observed path is allowed"]
    PATHS --> REVIEW["Review same-file content and outline completeness"]
    REVIEW --> ACCEPT["Accept only when the packet's other evidence also passes"]
    EXIT -->|1| INSPECT["Inspect each OUT_OF_SET path against the approved scope"]
    INSPECT -->|Files or approved scope corrected| RUN
    EXIT -->|2| REPAIR["Correct usage, revision or Git error; keep result unverified"]
    REPAIR --> RUN
```

**Exit 0 is a path-scope result, not packet acceptance.** The checker cannot detect same-file content loss or an omitted approved outline row; the scoped review must compare those inputs directly (see [E-0014](../../../.agents/harness-everything/errors/E-0014-lossy-cleanup.md) and [E-0016](../../../.agents/harness-everything/errors/E-0016-adr-draft-omits-approved-outline-row.md)). Run it after local gates and before accepting the slice. It does not install a hook or change CI behavior.
