# Harness OS Troubleshooting Guide

This guide helps you resolve common issues with Harness OS installation and usage. Platform enforcement claims follow [platform-capabilities.md](platform-capabilities.md).

## Installation Issues

### Permission Denied Errors

**Symptom:** `EACCES: permission denied` during installation

**Solution:**
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

### Node.js Version Issues

**Symptom:** `SyntaxError` or unsupported engine errors

**Solution:**
```bash
# Check your Node.js version
node --version

# Harness requires Node.js 18 or higher
# Update using nvm (recommended):
nvm install 18
nvm use 18

# Or download from https://nodejs.org/
```

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

# Reinstall Harness
npx github:dyphn1/Harness-everything uninstall
npx github:dyphn1/Harness-everything install
```

### Circuit Breaker Tripping Too Often

**Symptom:** `RULE OF 3 CIRCUIT BREAKER TRIGGERED!` frequently

**Solution:**
1. This is normal behavior on an integration surface that actually packages the circuit-breaker hooks: Harness is protecting you from infinite loops.
2. Follow the zoom-out instructions in the error message.
3. If it's a false positive on the Claude Code hook path, check the error signature:
   ```bash
   cat .claude/harness-everything/state/sessions/default/rule-of-3-state.json
   ```
4. Reset if needed:
   ```bash
   npm run harness:reset
   ```

Do not expect this Claude Code state file merely because Harness skills or an instruction-only platform integration are installed.

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
   npx github:dyphn1/Harness-everything install --cursor
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
   npx github:dyphn1/Harness-everything install --codex
   ```
3. Remember that this is the instruction-oriented installer path. It is different from the **local OpenAI plugin** package described below.

### Codex / local OpenAI plugin not appearing

**Symptom:** The Harness plugin is missing from the local Plugins Directory, skills are stale, or `SessionStart` / `UserPromptSubmit` behavior does not reflect the current repository package.

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

The local plugin mechanically injects the session policy and invariant-first routing contract. It does **not** imply full Claude Code hook parity; lack of `PreToolUse`, `PostToolUse`, or `Stop` behavior on this surface is not evidence that the packaged prompt hooks failed.

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
1. Check Claude Code hook execution time where applicable:
   ```bash
   time node hooks/scripts/rule-of-3.js < /dev/null
   ```
2. If >200ms, check for:
   - Large state files
   - Network calls in hooks
   - Complex file operations
3. Reset state if appropriate:
   ```bash
   rm -rf .claude/harness-everything/state/sessions/
   ```

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
node hooks/scripts/rule-of-3.js < payload.json
```

### Check State Files

```bash
# Claude Code hook-path state example
cat .claude/harness-everything/state/sessions/default/rule-of-3-state.json
cat .claude/harness-everything/state/sessions/default/handoff-state.json

# Reset Claude hook-path state
rm -rf .claude/harness-everything/state/sessions/
npm run harness:reset
```

### Manual Hook Testing

For deterministic cross-platform mechanism checks, prefer:

```bash
npm run test:mechanism
npm run test:docs:capabilities
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
- **Cause:** Circuit breaker tripped but no report written
- **Solution:** Follow the zoom-out instructions in the error message

---

*This troubleshooting guide covers the most common issues. For other problems, please open a GitHub issue with diagnostic information.*
