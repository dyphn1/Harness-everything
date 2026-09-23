## Findings

### F-01 — High — Resident token is readable by other Windows users

Reproduction:

```bash
node harness-everything/scripts/system-one/resident.js start \
  "<lane-worktree>/.lane/manifest.json"

state=$(node - <<'NODE'
const p='.lane/manifest.json', fs=require('fs');
const r=require('./harness-everything/scripts/system-one/resident');
const m=require('./harness-everything/scripts/system-one/provider').readManifest(p);
console.log(r.stateFiles(m,p).state)
NODE
)
icacls "$state"
```

Expected, per spec:

> “State ... is created with mode 0600 (on Windows it inherits the user-profile ACL).”

Observed:

```text
NT AUTHORITY\Authenticated Users:(I)(M)
BUILTIN\Users:(I)(RX)
BUILTIN\Administrators:(I)(F)
NT AUTHORITY\SYSTEM:(I)(F)
```

The token is readable by all local Users and modifiable by Authenticated Users in this worktree. The token permits authenticated score, ping, and shutdown operations.

Suggested fix: explicitly apply an owner-only Windows DACL to state, lock, and temporary files, or reject manifests whose parent ACL is not private. POSIX mode `0600` is not sufficient on Windows.

---

### F-02 — Medium — One unauthenticated slow connection blocks the resident server

Reproduction:

```bash
node harness-everything/scripts/system-one/resident.js start \
  "<lane-worktree>/.lane/manifest.json"

node .lane/bridge-slowloris.js \
  "<lane-worktree>/.lane/manifest.json"

node .lane/oversize-slow.js \
  "<lane-worktree>/.lane/manifest.json"
```

Expected, per spec:

> “A score never blocks on model loading.”

> “The client ... waits with Atomics.wait (1000 ms deadline).”

Observed:

```json
{"elapsedMs":1252,"status":0,"stdout":"{\"status\":\"unavailable\",\"reason\":\"provider-timeout\"}","stderr":""}
{"elapsedMs":1159,"status":0,"stdout":"{\"status\":\"unavailable\",\"reason\":\"provider-timeout\"}","stderr":""}
```

A connection that sends nothing, or sends an oversized request without closing, occupies the single Python request loop for approximately two seconds. Concurrent legitimate scoring therefore misses the Node client’s one-second deadline.

A 32-connection burst also exceeded the server backlog:

```json
{"n":24,"errors":7,"unauthorized":17}
{"n":32,"errors":15,"unauthorized":17}
```

Suggested fix: enforce a read deadline no greater than the client deadline, avoid blocking drain reads, and process connections concurrently or with an asynchronous event loop. Increase backlog only as a secondary mitigation.

---

### F-03 — Medium — Corrupt state file causes duplicate resident servers

Reproduction:

```bash
node harness-everything/scripts/system-one/resident.js start \
  "<lane-worktree>/.lane/manifest.json"

node .lane/corrupt-state.js \
  "<lane-worktree>/.lane/manifest.json"
```

Expected, per spec:

> “If no live server exists, the Node provider creates a start lock ... [and] spawns ...”

> “The server ... [deletes] only its own state file.”

Observed:

```json
{
  "oldPid":15228,
  "oldPort":54813,
  "immediate":{"status":"unavailable","reason":"provider-starting"},
  "ready":true,
  "newPid":40732,
  "newPort":54854,
  "oldPidAlive":true,
  "oldPing":{"reply":{"ok":true,"pid":15228}}
}
```

The invalid state caused a second Python server to start while the original server remained live and responsive. This duplicates model memory and CPU usage and leaves an orphan that normal `resident stop` cannot see.

Suggested fix: use a durable per-manifest ownership/heartbeat record, quarantine invalid state under an exclusive lock, and prevent a new server from starting until an existing instance is positively ruled out.

---

### F-04 — Medium — Failed executable spawn leaves a non-failed 60-second lock

Reproduction:

```bash
node harness-everything/scripts/system-one/resident.js stop \
  "<lane-worktree>/.lane/manifest.json"

node .lane/spawn-failure.js \
  "<lane-worktree>/.lane/manifest.json"
```

Expected, per spec:

> “A startup failure writes a bounded reason into the lock and exits; callers report `provider-unavailable` without respawning until the lock is 60 s old.”

Observed:

```json
{
  "first":{"status":"unavailable","reason":"provider-starting"},
  "lock":"{\"createdAt\":1790137422179}",
  "second":{"status":"unavailable","reason":"provider-starting"},
  "ensureReady1200ms":false,
  "stateExists":false,
  "lockExists":true
}
```

When `spawn()` emits its asynchronous `error` event, the lock remains with only `createdAt`; no bounded failure reason is written.

Suggested fix: handle the child `error` event by atomically writing a bounded failure reason to the same lock, and remove or age it according to the normal retry policy.

---

### F-05 — Low — Adapter accepts requests outside the Phase 0 contract

Reproduction:

```bash
node harness-everything/scripts/system-one/resident.js start \
  "<lane-worktree>/.lane/manifest.json"

node .lane/protocol-257.js \
  "<lane-worktree>/.lane/manifest.json"
```

Expected, per spec:

> “... for `score`, the Phase 0 request.”

The Phase 0 contract limits options to 256 and validates hashes, IDs, schema, and task fields.

Observed:

```json
{"ok":true,"scoreCount":257,"catalogHashMatches":true}
```

The direct resident protocol accepted 257 options and returned a successful response despite the request hash no longer matching the mutated option catalog. The normal Node client rejects this before sending, but any process that obtains the token can bypass that validation.

Suggested fix: make `_valid_score_request` enforce the complete Phase 0 request contract, including exact fields, hashes, IDs, and the 256-option maximum.

## Probe results

| Probe | Result |
|---|---|
| Wrong/missing token | PASS — bounded `unauthorized` |
| Non-JSON request | PASS — bounded `invalid-request` |
| NaN/huge numeric extras | PASS — no crash or echo |
| >2 MiB request with EOF | PASS — bounded `request-limit` |
| Exact 224-byte UTF-8 context | PASS — scored |
| 225-byte context | PASS — bounded `input-too-long` |
| 256 options | PASS — scored |
| Slowloris / oversized no-EOF | FAIL — see F-02 |
| Rapid connection burst | FAIL — backlog refusals, see F-02 |
| Malformed bridge reply | PASS — `error:"json"` |
| >1 MiB bridge reply | PASS — `error:"limit"` |
| 1-second bridge timeout | PASS — observed ~1011 ms |
| Six-way cold-start race | PASS — one isolated state/Python server observed |
| Hard-kill recovery | PASS — recovery worked after `Stop-Process -Force`; direct `taskkill.exe` was blocked by shell/sandbox behavior |
| Corrupt state | FAIL — duplicate server, see F-03 |
| Live unrelated port | Observed `provider-json` with state retained; consistent with malformed-reply mapping, not counted separately |
| Stale lock older than 60 s | PASS — replaced and restarted |
| Spawn failure | FAIL — see F-04 |
| Shadow secret-output check | PASS — token, checkpoint path, manifest path, and traceback absent |
| Hermetic tests with shadow config | PASS — 12/12 and router workflow 0 failures |
| Hermetic tests with variables unset | PASS — 12/12 and router workflow 0 failures |
| Existing resident tests | PASS — 7/7 |
| Existing adapter tests | PASS — 8/8 |
| Final cleanup | PASS — no state/lock file; all tester-started PIDs dead |

No product code or tests were modified. Only `.lane/` probe scripts, the existing manifest, and the local todo file are untracked.