# C6 packet briefing — Level 3 field contract, walkthroughs and review cases

> Supporting contract for [C6 — Level 2 Action Map](../actions/c6-action-map.md) and the [C6 briefing template](../templates/packet-briefing.md) ([#402](https://github.com/dyphn1/Harness-everything/issues/402), advisor answer 4 class C6). Concrete inputs, outputs, gates and test cases only; it changes no runtime behavior.

## Problem to prevent

- **E-0022** (`wrong-episode-rule-briefed`): a coordinator briefing gives a worker an episode/round rule that differs from the errors README, or shared briefing text drifts (stale input SHA, wrong report path; #448 W3 followed the shared common-gates file). Each packet's own input SHA is authoritative over the shared file.
- **E-0010** (`runtime-provenance-packet-local-reference`): a pin cited only inside a working packet cannot be followed by installed or public consumers; pins cite a durable public reference instead.

## Template field contract

| Field | Source requirement | Value rule |
| --- | --- | --- |
| Runner / model / effort | Packet's own execution context | Filled with the runner's own values |
| Worktree + input SHA | The packet's own worktree at its pinned input SHA | Filled; the shared common-gates SHA is never authoritative |
| Scope anchor | Verbatim quote with source (issue/PR/comment/owner decision) | Copied verbatim, never paraphrased |
| Write-set | Paths this packet may touch | Enumerated; "Nothing else" |
| Gate (dependsOn) | The invocation this gate binds, verbatim | The exact command the worker runs |
| Verification commands | Commands with expected exit codes | Runnable in this worktree |
| Error-ledger instruction | Read errors README and every E-*.md first | Name applied E-ids in the report |
| Report path + report-writer invocation | `write --body-file … --output … --status DONE\|BLOCKED --reason …`, then `check --file …` | The packet's own report path, never another packet's |
| Terminal STATUS rule | Last line column-zero `STATUS: DONE` / `STATUS: BLOCKED: <reason>`, nothing after | Enforced by report-writer `check` |
| Real dispatch cite | Added by the coordinator on the next dispatch | `N/A: real dispatch cite added by the coordinator on the next dispatch` until retained |

## Walkthrough: one stale shared default through the template

**Starting state:** class-common.md pins this slice at input SHA `e1a8f1ca` (branch `feat/402-eh-map`). The shared common-gates background carries a stale SHA (`fbdbf98b`, the W1 writer packet) and a stale report path (`.402-work/W1-report.md`).

**Input:** a packet draft that copies the shared file's SHA and report path into its own fields.

**Expected:** the packet's own fields win; the stale shared-gates SHA and inherited W1 output path are rejected; ambiguous instruction blocked.

**Actual (template applied):** input SHA field = `e1a8f1ca` (packet's own), report path = `.402-work/C6-report.md` (packet's own), gate invocation = this packet's gate commands. The conflicting common-gates SHA and the output path inherited from W1 do not reach the worker.

**Review rule applied:** a conflicting common-gates SHA or an output path inherited from a different packet blocks dispatch; a valid packet requiring invented values blocks dispatch.

## Walkthrough: one complete packet through the template

**Packet:** this C6 packet (`.402-work/C6.md`), worktree `.worktrees/402-c6`, input SHA `e1a8f1ca`.

**Gate commands (local slice gates):** `npm run test:consistency`, `npm run test:references`, `npm run test:portability`, plus the walkthroughs above as the slice's focused activity.

**Report:** body `.402-work/C6-body.md`; `npm run report -- write --body-file .402-work/C6-body.md --output .402-work/C6-report.md --status DONE`; then `… check --file .402-work/C6-report.md`. Report-bearing packets require the #462 report writer. Pin a runnable `write` and `check` invocation and the packet-owned paths at dispatch. Use `npm run report` where installed, or name the available direct script and its base. If no writer is available, resolve a usable invocation before dispatch or record the report as unresolved at acceptance; never hand-write the terminal STATUS.

**Terminal STATUS:** report's last line is exactly one column-zero `STATUS: DONE` (or `STATUS: BLOCKED: <reason>`), nothing after it.

**Real dispatch cite:** pending — retained by the coordinator on the next dispatch (`N/A: real dispatch cite added by the coordinator on the next dispatch`).

## Review cases (advisor gate, verbatim)

| Case | Input | Expected | Verdict rule |
| --- | --- | --- | --- |
| Conflicting common-gates SHA | Packet field filled from shared file instead of its own pinned SHA | Block dispatch | Blocks ambiguous instructions reaching dispatch |
| Output path inherited from another packet | `.402-work/W1-report.md` in a C6 packet | Block dispatch | Blocks a valid packet requiring invented values |
| Complete packet | All fields filled or `N/A: <reason>`, exact SHA/path/command | Gate passes | Packet briefing accepted |

## Evidence applied

- E-0010: packet-local provenance references are not durable; cite public issue/PR/comment URLs or repository-relative paths.
- E-0022: the errors README "Episodes vs rounds" section is the authority; each packet's own input SHA is authoritative over the shared common-gates file; a gate clause binds the exact invocation and verb.
- Memory witness #448: W3 was misled by packet template drift (common-gates SHA, wrong report path).

## Status of this detail

Structural contract only; no code, hooks, ledger schema, promotion or training-budget change. Effectiveness requires real dispatch evidence, which the coordinator retains on the next dispatch.
