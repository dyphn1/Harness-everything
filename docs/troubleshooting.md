# Harness OS Troubleshooting Guide

This guide helps you resolve common issues with Harness OS installation and usage.

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

3. Restart Claude Code session

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
1. This is normal behavior - Harness is protecting you from infinite loops
2. Follow the zoom-out instructions in the error message
3. If it's a false positive, check the error signature:
   ```bash
   cat .claude/harness-everything/state/sessions/default/rule-of-3-state.json
   ```

4. Reset if needed:
   ```bash
   npm run harness:reset
   ```

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

3. Restart Cursor

### Copilot Not Following Rules

**Symptom:** GitHub Copilot ignoring Harness guidance

**Solution:**
1. Check file exists:
   ```bash
   cat .github/copilot-instructions.md | head -20
   ```

2. Ensure Copilot is using the instructions file
3. Restart VS Code/GitHub Copilot

### Codex/AGENTS.md Issues

**Symptom:** Codex not recognizing Harness

**Solution:**
1. Check AGENTS.md exists:
   ```bash
   cat AGENTS.md | head -20
   ```

2. Reinstall with Codex flag:
   ```bash
   npx github:dyphn1/Harness-everything install --codex
   ```

## Performance Issues

### Slow Hook Execution

**Symptom:** Terminal commands feel slower

**Solution:**
1. Check hook execution time:
   ```bash
   time node hooks/scripts/rule-of-3.js < /dev/null
   ```

2. If >200ms, check for:
   - Large state files
   - Network calls in hooks
   - Complex file operations

3. Reset state:
   ```bash
   rm -rf .claude/harness-everything/state/sessions/
   ```

### High Memory Usage

**Symptom:** Node.js processes consuming too much memory

**Solution:**
1. Check for memory leaks:
   ```bash
   # Monitor Node.js processes
   ps aux | grep node
   ```

2. Restart session if needed
3. Report issue if persistent

## Debugging

### Enable Verbose Logging

```bash
# Set debug environment variable
export HARNESS_DEBUG=1

# Run with verbose output
node hooks/scripts/rule-of-3.js < payload.json
```

### Check State Files

```bash
# View current state
cat .claude/harness-everything/state/sessions/default/rule-of-3-state.json
cat .claude/harness-everything/state/sessions/default/handoff-state.json

# Reset all state
rm -rf .claude/harness-everything/state/sessions/
npm run harness:reset
```

### Manual Hook Testing

```bash
# Test rule-of-3 hook
echo '{"tool_name":"Bash","tool_input":{"command":"test"}}' | node hooks/scripts/rule-of-3.js

# Test state-persist hook
echo '{"tool_name":"Edit","tool_input":{"file_path":"test.js"}}' | node hooks/scripts/state-persist.js
```

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
ls -la .claude/ .cursorrules .github/copilot-instructions.md AGENTS.md .continue/rules/ .hermes.md 2>/dev/null >> harness-diagnostic.txt
echo "" >> harness-diagnostic.txt

echo "=== Hook Status ===" >> harness-diagnostic.txt
cat .claude/settings.json | grep -A 20 "hooks" >> harness-diagnostic.txt 2>/dev/null
echo "" >> harness-diagnostic.txt

echo "=== Recent Errors ===" >> harness-diagnostic.txt
# Add any recent error logs here
```

### Contact Support

1. **GitHub Issues:** https://github.com/dyphn1/Harness-everything/issues
2. **Include:** Diagnostic report, error messages, steps to reproduce
3. **Platform:** Specify which AI tool you're using (Claude Code, Cursor, etc.)

## Common Error Messages

### "Cannot find module './lib/harness-state'"
- **Cause:** Missing dependencies
- **Solution:** Run `npm install` or reinstall Harness

### "Routing-keywords.json missing/invalid"
- **Cause:** Configuration file corrupted
- **Solution:** Will fail open to Tier 1 - reinstall to restore

### "Session state not found"
- **Cause:** First run or state cleared
- **Solution:** Normal - state will be created on first use

### "Zoom-out report not found"
- **Cause:** Circuit breaker tripped but no report written
- **Solution:** Follow the zoom-out instructions in the error message

---

*This troubleshooting guide covers the most common issues. For other problems, please open a GitHub issue with diagnostic information.*
