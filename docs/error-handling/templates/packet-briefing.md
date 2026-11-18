# C6 packet briefing template (rev 1)

Copy this file per packet. **Every field is either filled with this packet's own authoritative value or `N/A: <reason>`.** Shared defaults (class-common.md, shared gates files) supply background only; they are never authoritative for this packet.

## Runner / model / effort
runner: <e.g. one-shot `codex exec` (model, effort), `-s workspace-write`>
model: <model>
effort: <reasoning effort>

## Worktree and input SHA
worktree: <cwd / path of this packet's own worktree>
input SHA: <pinned input SHA of this packet>
`N/A:` only if the packet performs no worktree-bound execution; state the reason.

## Scope anchor (verbatim with source)
- Owner <id> (date): "<verbatim quote>" — source: <issue / PR / comment / owner decision>
- <additional source>: "<verbatim quote>" — source: <…>

## Write-set
- <path> — <new / modify / read-only>
- …
Nothing else. Do not edit files outside the write-set.

## Gate (dependsOn)
<verbatim gate clause or command this packet binds>
Depends on: <previous packets / steps, or none>

## Verification commands
<commands to run, each with its expected exit code>

## Error ledger
Read `.agents/harness-everything/errors/README.md` and every `E-*.md` before starting. Name the applied E-ids in the report.

## Report path and report-writer invocation
Body in `.402-work/<ID>-body.md`, then:
`npm run report -- write --body-file .402-work/<ID>-body.md --output .402-work/<ID>-report.md --status DONE` (or `--status BLOCKED --reason "<why>"`), then:
`npm run report -- check --file .402-work/<ID>-report.md`.
Sections: files changed; RED/walkthrough evidence; GREEN; gates with exit codes; E-ids; open questions / follow-ups (out-of-slice → listed, not fixed).

## Terminal STATUS rule
The report's last line is exactly one column-zero `STATUS: DONE` or `STATUS: BLOCKED: <reason>`; nothing after it.

## Real dispatch cite
`N/A: real dispatch cite added by the coordinator on the next dispatch.` — retained by the coordinator when this packet is dispatched for real.
