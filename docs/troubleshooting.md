# Harness OS Troubleshooting Guide

This guide helps you resolve common issues with Harness OS installation and usage. Platform enforcement claims follow [platform-capabilities.md](platform-capabilities.md). Current Node/workflow values are generated in [repository-contract.md](repository-contract.md).

## Installation Issues

### Permission Denied Errors

**Symptom:** `EACCES: permission denied` during installation

**Solution:**

POSIX shells / Git Bash:
```bash
# Option 1: Install without sudo (recommended)
npx github:dyphn1/Harness-everything install

# Option 2: If you need global installation
npx github:dyphn1/Harness-everything install --global

# Option 3: Fix npm permissions (if using npm)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

Windows PowerShell:
```powershell
npx.cmd github:dyphn1/Harness-everything install
npx.cmd github:dyphn1/Harness-everything install --global
```

### Node.js Version Issues

**Symptom:** `SyntaxError` or unsupported engine errors

**Solution:**
```bash
# Check your Node.js version
node --version

# Harness supports Node.js 22 or newer.
# Node.js 24 is the primary/recommended development runtime.
nvm install 24
nvm use 24

# To reproduce the minimum-runtime CI lane explicitly:
nvm install 22
nvm use 22

# Or download a supported release from https://nodejs.org/
```

The checked-in `.nvmrc` selects the primary runtime. If runtime/workflow files change, run `npm run docs:sync` followed by `npm run test:repo-contract` so generated current-state documentation cannot drift.

### Network Issues

**Symptom:** `npm ERR! network` or timeout errors

**Solution:**
```bash
# Check your internet connection
npm ping

# Try with different registry
npm config set registry https://registry.npmjs.org/

# Clear npm cache
npm cache clean --force

# Use yarn instead
yarn install
```

## Hook Issues

### Hooks Not Firing (Claude Code)

**Symptom:** Harness rules not being enforced

**Solution:**
1. Verify hooks are installed:
   ```bash
   cat .claude/settings.json | grep -A 10 "hooks"
   ```
2. Check hook file permissions:
   ```bash
   ls -la hooks/scripts/*.js
   ```
3. Restart Claude Code session.

### Hook Execution Errors

**Symptom:** `Error: Cannot find module` or similar

**Solution:**
```bash
# Verify Node.js is in PATH
which node

# Check if hooks directory exists
ls -la hooks/scripts/

# Reinstall Harness (POSIX shells / Git Bash)
npx github:dyphn1/Harness-everything uninstall
npx github:dyphn1/Harness-everything install
```

Windows PowerShell:
```powershell
npx.cmd github:dyphn1/Harness-everything uninstall
npx.cmd github:dyphn1/Harness-everything install
```

### Retired Rule-of-3 and reset paths

The former `hooks/scripts/rule-of-3*.js`, `reset-circuit-breaker.js`, forced report/unlock path, and OpenCode hard-lock path are retired under [#394](https://github.com/dyphn1/Harness-everything/issues/394). Old breaker messages or state files are historical; they are not a current retry counter or reset workflow. Zoom-out is agent-initiated and can be chosen on the first meaningful signal; productive work may continue when the next check is justified by evidence. See [the Zoom-out workflow](workflows/zoom-out.md).

## Platform-Specific Issues

### Cursor Not Showing Rules

**Symptom:** `.cursorrules` file not created

**Solution:**
1. Verify file exists:
   ```bash
   cat .cursorrules | head -20
   ```
2. If missing, reinstall with Cursor flag:
   ```bash
   # POSIX shells / Git Bash
   npx github:dyphn1/Harness-everything install --cursor
   ```
   ```powershell
   # Windows PowerShell
   npx.cmd github:dyphn1/Harness-everything install --cursor
   ```
3. Restart Cursor.

### Copilot Not Following Rules

**Symptom:** GitHub Copilot ignoring Harness guidance

**Solution:**
1. Check file exists:
   ```bash
   cat .github/copilot-instructions.md | head -20
   ```
2. Ensure Copilot is using the instructions file.
3. Restart VS Code/GitHub Copilot.

### Codex advisory installer / AGENTS.md issues

**Symptom:** Codex does not appear to receive the general installer guidance.

**Solution:**
1. Check `AGENTS.md` exists and contains Harness guidance:
   ```bash
   cat AGENTS.md | head -20
   ```
2. Reinstall the advisory Codex target if needed:
   ```bash
   # POSIX shells / Git Bash
   npx github:dyphn1/Harness-everything install --codex
   ```
   ```powershell
   # Windows PowerShell
   npx.cmd github:dyphn1/Harness-everything install --codex
   ```
3. Remember that this is the instruction-oriented installer path. It is different from the **local OpenAI plugin** package described below.

### Codex / local OpenAI plugin not appearing

**Symptom:** The Harness plugin is missing from the local Plugins Directory, skills are stale, or packaged lifecycle behavior does not reflect the current repository package.

**Checks:**
```bash
npm run plugin:sync
npm run test:plugin:openai
```

Then verify the repository contains:

```text
.agents/plugins/marketplace.json
plugins/harness-everything/.codex-plugin/plugin.json
plugins/harness-everything/hooks/hooks.json
plugins/harness-everything/hooks/session-start.js
plugins/harness-everything/skills/
```

If those checks pass but the host still shows an older copy:

1. Refresh/sync the imported marketplace or repository plugin in the host.
2. Restart/refresh the local ChatGPT/Codex host if it cached the plugin package.
3. Start a **new chat/session** before judging `SessionStart` or `UserPromptSubmit` behavior.
4. Re-review/trust changed command hooks if the host asks again after hook definitions changed.

The local plugin mechanically injects the session policy and invariant-first routing contract, and its package includes mechanism-tested supported-tool, subagent, and stop adapters. If those events do not appear in a live session, verify the host loaded the current package and that changed command hooks were reviewed/trusted; package tests alone cannot prove host loading.

For the native host install/update path, run:

```bash
# POSIX shells / Git Bash
npx github:dyphn1/Harness-everything plugin-sync --json
```

```powershell
# Windows PowerShell
npx.cmd github:dyphn1/Harness-everything plugin-sync --json
```

The command installs only when the plugin is absent. An installed Claude plugin uses the explicit Claude update command; an installed Codex plugin uses marketplace upgrade. If plugin state cannot be read, synchronization stops without re-adding or overwriting the plugin.

Host CLIs differ in which options and subcommands they implement, so the synchronizer degrades instead of failing:

- An option the host rejects — `unknown option '--json'` (commander) or `unexpected argument '--json' found` (clap/Codex) — is dropped and the command is retried without it.
- A Codex build that ships only `codex plugin marketplace` has no `codex plugin list`/`codex plugin add`. The marketplace source is still registered and the host is reported as `[skip] codex: …` with an actionable reason, not as a failure. Upgrade the Codex CLI, or enable the plugin from Codex, to complete installation.

If several `codex`/`claude` binaries are on `PATH` (for example an npm shim plus a separately installed build), the synchronizer resolves the same one your interactive shell would: it walks `PATH` directories in order and, on Windows, tries `PATHEXT` extensions within each directory before moving to the next — matching `cmd.exe`/PowerShell/`which` resolution, so directory order decides the match, not which candidate happens to be a directly launchable `.exe`. If the reported capabilities still look stale, an orphaned install is genuinely earlier on `PATH` than the one you expect; check `where codex` (Windows) or `which -a codex` (POSIX) to see the full resolution order, and remove or reorder the stale entry.

See [openai-plugin.md](openai-plugin.md) for installation and validation details.

### Public OpenAI Skills-only plugin behaves differently from local Codex plugin

**Symptom:** A public/reviewer Skills-only install does not run local `.codex-plugin` lifecycle hooks.

**Expected behavior:** This is by design. The public Skills-only upload contains reusable skills and referenced assets, but not the local `.codex-plugin` lifecycle hooks. Validate public behavior with:

```bash
npm run plugin:submission:build
npm run test:plugin:submission
```

Do not troubleshoot a missing `SessionStart` or `UserPromptSubmit` hook in the public Skills-only artifact as if it were a packaging defect.

### OpenCode plugin implementation works in tests but host loading is uncertain

**Symptom:** Source/mechanism tests pass, but there is no evidence that a real OpenCode session loaded and fired the plugin.

**Interpretation:** The current repository claim is intentionally **mechanism-tested, live loading unverified**. Check [`../opencode-plugin/README.md`](../opencode-plugin/README.md) and run the OpenCode mechanism coverage. Do not promote a source-level pass into a live-host pass without a real session artifact.

## Performance Issues

### Slow Hook Execution

**Symptom:** Terminal commands feel slower on a hook-enabled integration.

**Solution:**
1. Check the host's diagnostics for the active hook path.
2. If execution remains slow, check for:
   - Large state files
   - Network calls in hooks
   - Complex file operations
### High Memory Usage

**Symptom:** Node.js processes consuming too much memory

**Solution:**
1. Check for memory leaks:
   ```bash
   ps aux | grep node
   ```
2. Restart session if needed.
3. Report issue if persistent.

## Debugging

### Enable Verbose Logging

```bash
export HARNESS_DEBUG=1
```

The former Rule-of-3 hook and its state diagnostics are retired under [#394](https://github.com/dyphn1/Harness-everything/issues/394); this flag does not provide a current breaker trace.

### Check State Files

```bash
# Claude Code hook-path handoff state example
cat .claude/harness-everything/state/sessions/default/handoff-state.json
```

### Manual Hook Testing

For deterministic cross-platform mechanism checks, prefer:

```bash
npm run test:mechanism
npm run test:docs:capabilities
npm run test:repo-contract
```

When isolating a specific Claude hook, use the Windows-safe `spawnSync` recipes in [../VERIFICATION.md](../VERIFICATION.md) rather than assuming a shell `echo | node` pipeline behaves the same on every OS.

## Getting Help

### Collect Diagnostic Information

```bash
# Generate diagnostic report
echo "=== System Info ===" > harness-diagnostic.txt
node --version >> harness-diagnostic.txt
npm --version >> harness-diagnostic.txt
echo "" >> harness-diagnostic.txt

echo "=== Harness Version ===" >> harness-diagnostic.txt
cat package.json | grep version >> harness-diagnostic.txt
echo "" >> harness-diagnostic.txt

echo "=== Installed Platforms ===" >> harness-diagnostic.txt
ls -la .claude/ .cursorrules .github/copilot-instructions.md AGENTS.md .continue/rules/ .hermes.md .agents/plugins/ plugins/harness-everything/ 2>/dev/null >> harness-diagnostic.txt
echo "" >> harness-diagnostic.txt

echo "=== Hook Status ===" >> harness-diagnostic.txt
cat .claude/settings.json | grep -A 20 "hooks" >> harness-diagnostic.txt 2>/dev/null
```

### Contact Support

1. **GitHub Issues:** https://github.com/dyphn1/Harness-everything/issues
2. **Include:** Diagnostic report, error messages, steps to reproduce
3. **Platform:** Specify which AI tool and which Harness installation surface you're using (for example `--codex` advisory installer vs local OpenAI plugin vs public Skills-only plugin).

## Common Error Messages

### "Cannot find module './lib/harness-state'"
- **Cause:** Missing dependencies
- **Solution:** Run `npm install` or reinstall Harness

### "Routing-keywords.json missing/invalid"
- **Cause:** Configuration file corrupted
- **Solution:** Will fail open to Tier 1 - reinstall to restore

### "Session state not found"
- **Cause:** First run, state cleared, or the selected platform surface does not create that runtime state
- **Solution:** Confirm the platform/integration surface first; on a supported stateful hook path, state is created on first use

### "Zoom-out report not found"
- **Cause:** An old Rule-of-3 integration expected a compulsory report; that path is retired under [#394](https://github.com/dyphn1/Harness-everything/issues/394).
- **Solution:** Use [the agent-initiated Zoom-out guidance](workflows/zoom-out.md) when evidence warrants reassessment; no special report or reset is required.

---

*This troubleshooting guide covers the most common issues. For other problems, please open a GitHub issue with diagnostic information.*
