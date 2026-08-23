#!/usr/bin/env node
/**
 * Self-healing installation audit for Harness OS.
 *
 * Audits the six platform integration touchpoints in the current workspace
 * and, when any are missing, re-runs the idempotent installer to repair them.
 * This makes the harness portable across editors: install once via Claude
 * Code, then open the same repo in Copilot/Cursor/Codex/Continue/Hermes and
 * the missing advisory instructions are backfilled automatically the first time
 * harness-everything (or the environment-detection Discover phase) runs.
 *
 * Usage:
 *   node self-heal.js            Audit and repair anything missing.
 *   node self-heal.js --check    Audit only; report, never write.
 *   node self-heal.js --force-self  Allow repairing harness-everything repo
 *                                   itself (skipped by default to avoid
 *                                   polluting this repo with generated files).
 *
 * Repair strategy: delegate to scripts/installer.js rather than duplicating
 * its logic - the installer merges hooks by id and appends advisory text only
 * when its marker is absent, so re-running it is always safe.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'Harness OS Guidance (Advisory)';
const HOOK_ID = 'harness:pre:bootstrap';

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function fileContains(filePath, needle) {
  try {
    return fs.readFileSync(filePath, 'utf8').includes(needle);
  } catch (err) {
    return false;
  }
}

// Presence of the hook id alone is not enough: the skills repo may have been
// MOVED since install (it already happened once - harness-everything to
// miya.daniel/skills), leaving settings.json full of absolute paths to dead
// scripts while still "containing" the id. Verify every harness hook command
// points at a script that actually exists on disk.
function auditClaudeHooks(workspaceRoot) {
  const settingsPath = path.join(workspaceRoot, '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return { ok: false, detail: 'not installed' };
  }
  const commands = [];
  for (const list of Object.values(settings.hooks || {})) {
    for (const item of list) {
      if (typeof item.id === 'string' && item.id.startsWith('harness:')) {
        (item.hooks || []).forEach(h => {
          if (h.type === 'command' && h.command) commands.push(h.command);
        });
      }
    }
  }
  if (commands.length === 0) return { ok: false, detail: 'not installed' };
  for (const cmd of commands) {
    // Our hook commands are exactly `node <script>` with no extra args, in
    // one of three historical quoting styles; stripping the prefix and all
    // quotes yields the script path in every one of them.
    const scriptPath = cmd.replace(/^node\s+/, '').replace(/"/g, '').trim();
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, detail: `stale script path: ${scriptPath}` };
    }
  }
  return { ok: true };
}

function auditWorkspace(workspaceRoot) {
  // 1. 環境變數偵測 (Environment Detection)
  //    NOTE: TERM_PROGRAM=vscode / VSCODE_PID are deliberately NOT treated as
  //    Copilot signals - Claude Code's integrated terminal reports vscode too,
  //    and treating it as Copilot made self-heal backfill .github/ artifacts
  //    (and copy every global skill into the project) for Claude-driven repos.
  //    Only explicit Copilot runtime signals count here.
  const isClaudeEnv = process.env.CLAUDECODE === '1' || process.env.CLAUDE_CODE === 'true' || process.env.CLAUDE === '1' || false;
  const isCursorEnv = process.env.TERM_PROGRAM === 'cursor' || process.env.CURSOR_SANDBOX !== undefined || false;
  const isCopilotEnv = process.env.GITHUB_COPILOT_CHAT === 'true' || process.env.COPILOT_AGENT === '1' || (process.env.AI_AGENT?.includes('copilot') ?? false);

  // 2. 專案現存檔案偵測 (Workspace File Detection)
  const hasClaudeFiles = fs.existsSync(path.join(workspaceRoot, '.claude'));
  const hasCursorFiles = fs.existsSync(path.join(workspaceRoot, '.cursorrules')) || fs.existsSync(path.join(workspaceRoot, '.cursor'));
  const hasCopilotFiles = fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md'));
  const hasCodexFiles = fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
  const hasContinueFiles = fs.existsSync(path.join(workspaceRoot, '.continue'));
  const hasHermesFiles = fs.existsSync(path.join(workspaceRoot, '.hermes.md'));

  // 3. 決定哪些平台是「活躍」的（已初始化或目前正在使用該環境）
  const activePlatforms = {
    claude: isClaudeEnv || hasClaudeFiles,
    cursor: isCursorEnv || hasCursorFiles,
    copilot: (!isClaudeEnv && !isCursorEnv && isCopilotEnv) || hasCopilotFiles,
    codex: hasCodexFiles,
    continue: hasContinueFiles,
    hermes: hasHermesFiles
  };

  // 如果偵測完，沒有任何活躍平台（全新專案第一次執行 self-heal），只在有明確
  // 環境訊號時提供預設平台；否則不修復 - 寧可不做也不要猜測並汙染工作區。
  const hasAnyActive = Object.values(activePlatforms).some(v => v);
  if (!hasAnyActive) {
    if (isClaudeEnv) {
      activePlatforms.claude = true;
    } else if (isCursorEnv) {
      activePlatforms.cursor = true;
    } else if (isCopilotEnv) {
      activePlatforms.copilot = true;
    }
  }

  const checks = [];

  if (activePlatforms.claude) {
    const claudeHooks = auditClaudeHooks(workspaceRoot);
    checks.push({
      label: 'Claude Code hooks (.claude/settings.json)' + (claudeHooks.detail ? ` - ${claudeHooks.detail}` : ''),
      ok: claudeHooks.ok,
      platform: 'claude'
    });
  }

  if (activePlatforms.cursor) {
    checks.push({
      label: 'Cursor rules (.cursorrules)',
      ok: fileContains(path.join(workspaceRoot, '.cursorrules'), MARKER),
      platform: 'cursor'
    });
  }

  if (activePlatforms.copilot) {
    checks.push({
      label: 'Copilot instructions (.github/copilot-instructions.md)',
      ok: fileContains(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), MARKER),
      platform: 'copilot'
    });
  }

  if (activePlatforms.codex) {
    checks.push({
      label: 'Codex instructions (AGENTS.md)',
      ok: fileContains(path.join(workspaceRoot, 'AGENTS.md'), MARKER),
      platform: 'codex'
    });
  }

  if (activePlatforms.continue) {
    checks.push({
      label: 'Continue.dev rules (.continue/rules/harness.md)',
      ok: fileContains(path.join(workspaceRoot, '.continue', 'rules', 'harness.md'), MARKER),
      platform: 'continue'
    });
  }

  if (activePlatforms.hermes) {
    checks.push({
      label: 'Hermes Agent instructions (.hermes.md)',
      ok: fileContains(path.join(workspaceRoot, '.hermes.md'), MARKER),
      platform: 'hermes'
    });
  }

  return checks;
}

function printAudit(checks) {
  console.log('[Harness Self-Heal Audit]');
  checks.forEach(c => {
    console.log(`  ${c.ok ? 'OK     ' : 'MISSING'}  ${c.label}`);
  });
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const forceSelf = process.argv.includes('--force-self');

  const workspaceRoot = getWorkspaceRoot();
  const harnessSourceDir = path.resolve(__dirname, '..', '..');
  const installerPath = path.join(harnessSourceDir, 'scripts', 'installer.js');

  console.log(`Workspace: ${workspaceRoot}`);
  const checks = auditWorkspace(workspaceRoot);
  printAudit(checks);

  const missing = checks.filter(c => !c.ok);
  if (missing.length === 0) {
    console.log('\nAll active integration touchpoints present. Nothing to repair.');
    return;
  }

  if (checkOnly) {
    console.log(`\n${missing.length} active touchpoint(s) missing. Run without --check to repair:`);
    console.log(`  node "${path.join(__dirname, 'self-heal.js')}"`);
    return;
  }

  const isSelf = path.resolve(workspaceRoot) === path.resolve(harnessSourceDir);
  if (isSelf && !forceSelf) {
    console.log('\nWorkspace IS the harness-everything repo itself - skipping repair to avoid');
    console.log('polluting it with generated config files. Pass --force-self to override.');
    return;
  }

  if (!fs.existsSync(installerPath)) {
    console.error(`\nCannot repair: installer not found at ${installerPath}`);
    process.exit(1);
  }

  console.log(`\nRepairing ${missing.length} missing active touchpoint(s) via installer...\n`);
  
  // 構造參數只針對當前環境缺少的平台調用安裝器。--no-skills 讓修復只回補
  // 該平台的整合觸點（advisory 檔案 / hooks 設定），絕不把全域 skills 複製進
  // 專案 - skills 的安裝與否是使用者明確的選擇，不是 self-heal 的職權。
  const activeFlags = missing.map(c => `--${c.platform}`).join(' ');
  execSync(`node "${installerPath}" ${activeFlags} --no-skills --yes`, { cwd: workspaceRoot, stdio: 'inherit' });

  const after = auditWorkspace(workspaceRoot);
  console.log('');
  printAudit(after);
  const stillMissing = after.filter(c => !c.ok);
  if (stillMissing.length > 0) {
    console.error(`\nSelf-heal incomplete: ${stillMissing.length} touchpoint(s) still missing.`);
    process.exit(1);
  }
  console.log('\nSelf-heal complete. Active platforms are now covered.');
}

main();
