# Windows AGY read-only handoff for #516 (2026-11-26)

AGY CLI 1.5.17 with Gemini 4 Hydrogen (High) ran the two reported commands separately in a clean disposable Git workspace on Windows PowerShell 5.1.26100.9818 with Node 24.18.0 and no pwsh. A project-scope capture hook forwarded the live payloads to the PR's packaged PostToolUse and Stop scripts with a dedicated Harness state directory. The pre-existing global plugin used its own state and also ran.

| Live command | Result reported by AGY |
|---|---|
| `git grep -n "mechanism-516"` | Exit 0, matched the seeded README |
| `$PSVersionTable.PSVersion; Get-Command pwsh -ErrorAction SilentlyContinue` | Exit 1, printed the PowerShell version and found no pwsh |

[Sanitized capture](capture.sanitized.jsonl) records the event keys, allowlisted probe commands, and packaged hook decisions. Both PostToolUse events had an empty error string and omitted a response and numeric exit status. The isolated handoff finished idle with neither `lastEditAt` nor `lastVerifyAt`. The patched Stop hook returned `allow` on both deliveries. The older global plugin requested one continuation from its separate state.

This trace covers these two shell outcomes and normal Stop delivery. Async launch/completion, wait markers, subdirectory workspace behavior, and installation of the patched global plugin remain outside this trace. The missing structured status leaves automatic verification credit unavailable for these payloads.
