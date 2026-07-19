#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

function checkCmd(cmd) {
  try {
    if (os.platform() === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore' });
    } else {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
    }
    return true;
  } catch (e) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

console.log("# [Environment Preflight Report]");
console.log(`- **Operating System**: ${os.platform()} (${os.release()} ${os.arch()})`);

// Shell Detection
let shell = process.env.SHELL || process.env.COMSPEC || "Unknown";
let shellName = "Unknown Shell";

if (shell.toLowerCase().includes("bash")) {
  shellName = "Git Bash / Bash";
} else if (shell.toLowerCase().includes("powershell") || shell.toLowerCase().includes("pwsh") || process.env.PSModulePath) {
  shellName = "PowerShell";
} else if (shell.toLowerCase().includes("cmd.exe")) {
  shellName = "Windows Command Prompt (CMD)";
} else {
  shellName = shell;
}

console.log(`- **Active Shell**: ${shellName} (Path: \`${shell}\`)`);
console.log(`- **Terminal Program**: ${process.env.TERM_PROGRAM || "Standard Terminal"}`);

// CLI Tools Check
const tools = ['git', 'docker', 'docker-compose', 'node', 'pnpm', 'npm', 'python', 'pip'];
const availableTools = [];
for (const tool of tools) {
  if (checkCmd(tool)) {
    availableTools.push(tool);
  }
}
console.log(`- **Available CLI Tools**: ${availableTools.join(', ') || 'None'}`);

// Sandbox Capabilities Detection
const hasDocker = availableTools.includes('docker');
const hasSandboxExec = checkCmd('sandbox-exec');
const sandboxCapabilities = [];
if (hasSandboxExec) sandboxCapabilities.push('macOS Seatbelt (sandbox-exec)');
if (hasDocker) sandboxCapabilities.push('Docker Containers');
if (os.platform() === 'win32') {
  sandboxCapabilities.push('Windows AppContainer (Native)');
}
console.log(`- **Sandbox Capabilities**: ${sandboxCapabilities.join(', ') || 'No isolation sandbox detected'}`);

// Repo Status
try {
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  console.log(`- **Git Workspace**: Detected (Branch: \`${branch}\`)`);
} catch (e) {
  console.log(`- **Git Workspace**: No git repository detected in ${process.cwd()}`);
}

// Recommended Syntax Guardrails
console.log("\n## [Syntax & Command Guardrails for this Environment]");
if (os.platform() === 'win32') {
  if (shellName.includes("Bash")) {
    console.log("- **Path Handling**: ALWAYS use `/` slashes for directory paths in commands (e.g., `scripts/run.js`). Avoid raw backslashes `\\` as they act as escape chars.");
    console.log("- **Environment Variables**: Use `$VAR` syntax. Do NOT use `%VAR%` or `$env:VAR`.");
    console.log("- **Command Chaining**: Use `&&` for sequence, `|` for piping.");
    console.log("- **Avoid Native Windows Commands**: Do NOT use `dir`, `copy`, or `del`. Use bash standard equivalents `ls`, `cp`, `rm`.");
  } else if (shellName.includes("PowerShell")) {
    console.log("- **Path Handling**: Slashes `/` or `\\` are generally acceptable.");
    console.log("- **Environment Variables**: Use `$env:VAR` syntax.");
    console.log("- **Command Chaining**: Use `;` or `&&` (if PowerShell 7+). Avoid bash-specific commands like `grep`, `awk`, `sed` unless explicitly piping.");
  } else {
    console.log("- **Path Handling**: Use `\\` for directories.");
    console.log("- **Environment Variables**: Use `%VAR%`.");
    console.log("- **Chaining**: Use `&`.");
  }
} else {
  console.log("- **Unix Native**: Standard Bash/Zsh syntax applies. Use relative paths, pipeline chaining, and standard utilities.");
}
