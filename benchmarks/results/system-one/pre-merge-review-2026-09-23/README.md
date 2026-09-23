# System One: pre-merge review of the resident provider (2026-09-23)

This is the retained evidence behind PR [#240](https://github.com/dyphn1/Harness-everything/pull/240) for issue [#233](https://github.com/dyphn1/Harness-everything/issues/233).

- **Evidence layers:** independent lane reports, local real-checkpoint runs, and one live-host observation.
- **Not claimed:** any Harness routing quality; the only available checkpoint is `cua-ai/cua-s1-forms` (domain `forms-v1`).
- **Redaction:** lane reports were copied verbatim except for secrets, user names and local paths. Tokens are `<redacted>`; paths are `~`, `<repo>` or `<lane-worktree>`.

## Files

| File | What it is |
| --- | --- |
| [haiku-spec-conformance.md](haiku-spec-conformance.md) | Claude Haiku lane: clause-by-clause spec check against the real CPU checkpoint |
| [luna-adversarial.md](luna-adversarial.md) | Codex `gpt-5.6-luna` lane: adversarial security/robustness findings F-01–F-05 |
| [skill-top1-probe.js](skill-top1-probe.js) | Script for the historical-keyword → skill top-1 probe |
| [skill-top1-probe.json](skill-top1-probe.json) | Unmodified probe output: option catalog, per-input rows, summary |

The lanes ran in separate git worktrees at `42655fa`. Each used its own manifest copy (real venv and checkpoint), so each got its own resident server. Neither lane was allowed to edit product code.

## What was re-verified by the reviewer (lane claims are not accepted alone)

- **Haiku, 24/24 PASS:** I re-ran its idle-exit script. With `idleTimeoutMs: 60000`, the state file was present at 55 s and gone at 60 s.
  - Discrepancy: the report names `.lane/idle/manifest.json`, but the script used `.lane/idle-manifest.json`. The result is unaffected.
- **Luna, F-01–F-05:** each finding got a RED-first regression test in PR #240 (commits `ee5ab0f`, `e59af73`). I then re-ran the lane's own probe scripts against the fixed code with the real model:

| # | Before | After |
| --- | --- | --- |
| F-01 | state file (token) inherited `Users:(RX)` / `Authenticated Users:(M)` on D:\\ | protected DACL with one full-control ACE for the current user SID |
| F-02 | a silent connection made a legitimate call time out (1252 ms) | legitimate call scored in 305 ms |
| F-03 | corrupted state left the old server alive and serving | old server exits (`oldPidAlive: false`) |
| F-04 | un-spawnable executable left a plain 60 s lock | `spawn-failed` → `provider-unavailable` |
| F-05 | 257 options accepted | `invalid-request` |

- **CI caught two follow-ups on the first push:**
  - The GitHub Windows runner creates files with *explicit* SYSTEM, Administrators and OWNER RIGHTS entries that `icacls /grant:r` keeps. The whole DACL is now replaced through `SetNamedSecurityInfoW`.
  - On POSIX, an exited child stays a zombie until the blocked test process reaps it, so S1-RS09 now asserts "stopped serving".
- **F-03 in real use:** before the fix, this machine had an orphan server for the real manifest that its state file no longer named. It was most likely produced when a burst overflowed the old backlog of 16 and the client treated the refused connection as a dead server. I stopped it manually.

## Install forms

The hook entry `kernel-router.js` was run with a host-shaped stdin payload (`{"prompt": ...}`) in shadow mode against the real resident server. Every form below scored (`abstain/domain-mismatch`) with no token in the output:

- repo checkout
- staged Claude plugin (tracked files only)
- Codex plugin copy
- skills install `--claude --codex --copy` into a temp project
- after release: the installed Claude Code 0.22.0 and Codex 0.22.0 plugin caches

The public OpenAI Skills-only bundle ships the scripts but no hooks.

- **Packaging defect found here:** `__pycache__/*.pyc` from Python test runs was being shipped by plugin sync, the skills installer and the public submission bundle. Fixed in PR #240 (`58135ae`).
- **Cold start through the hook entry:** returned `provider-starting` in 473 ms. The detached server survived the hook process exiting, and the next call was scored.

## Live-host observation (Windows 11, Claude Code, plugin 0.22.0)

Setup:
- `~/.claude/settings.json` `env` set to `HARNESS_SYSTEM_ONE_MODE=shadow` plus the manifest path.
- The resident server stopped first.

Then one headless `claude -p "Reply with the single word OK." --max-turns 1` session ran:
1. The session exited after 8 s with output `OK`.
2. Twelve seconds later a resident server was running, with a start time inside that session's window.

Conclusion: the real `UserPromptSubmit` hook started the server, and the server outlived the host's hook runner.

- **Scope:** one observation. macOS/Linux hosts and a Codex host were not live-verified.
- **Host environment variables:** settings `env` values are hot-reloaded into the session and are inherited by every command the agent runs, not only by hooks. A Codex started from a normal terminal sees them only if they are set at user/OS level.

## Historical keywords → does top-1 point to the right skill?

Method:
- Candidates are the 26 canonical skills. Each option is `"<skill>: <SKILL.md description>"`, cut at a word boundary to ≤ 96 bytes (the checkpoint's option limit).
- Set A: each `routing-keywords.json` guide-group keyword. Gold = the skills its group routes to.
- Set B: each positive `evals/*/tasks/*.yaml` prompt. Gold = that eval's skill.
- The raw argmax is reported. `decide()` rejected every result as `domain-mismatch`.

| Set | n | Model top-1 | Random top-1 | Model top-3 | Random top-3 |
| --- | --- | --- | --- | --- | --- |
| A: keywords | 305 | 8.2% | 11.6% | 25.9% | 31.0% |
| B: eval prompts | 34 | 5.9% | 3.8% | 8.8% | 11.5% |

- **Collapse:** top-1 piles onto a few options; in set A, `find-skills` takes 90 of 305.
- **High-confidence errors:** 16 in set A and 1 in set B have p ≥ 0.9, for example `refactor` → `skill-creator` at 0.95.
- **Lexical baseline:** the lexical router recommends the gold skill for 29 of 34 set-B prompts.
- **Conclusion:** the forms checkpoint cannot route skills. Keep System One `off` until a Harness-trained checkpoint passes the Phase 4 gates.

Re-run (needs the installed manifest):

```bash
node benchmarks/results/system-one/pre-merge-review-2026-09-23/skill-top1-probe.js \
  "$(pwd)" ~/.agents/harness-everything/system-one/manifest.json /tmp/skill-top1-probe.json
```
