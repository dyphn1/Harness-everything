# OpenCode session workspace field trace

**Observed:** OpenCode 2.1.4 on macOS, 2026-11-15. One server process handled sessions from two workspaces.

The retained [probe](live-workspace-probe.js) logged setup and prompt field shapes to [JSONL](live-workspace-trace-2026-11-15.jsonl). Setup exposed `ctx.location.directory`; prompt events exposed `sessionID`, `messageID`, `prompt`, `metadata`, and `delivery`, with no event location. For each prompt, `ctx.session.get({sessionID})` returned a session whose `location.directory` matched that session's setup workspace. The server process cwd was a different directory.

This trace establishes that the session lookup and directory field were available in these two runs. Both setup locations already matched their session directories, so the trace does not establish behavior for a setup/session mismatch, missing setup location, failed lookup, or V2 router/tool/completion hook firing. It is not a live reproduction of the workspace attribution defect or verification of the fix. The cross-workspace counterexample and fix are covered by the deterministic V2 default-export test `ci/mechanism-397-opencode-observations.test.js`.
