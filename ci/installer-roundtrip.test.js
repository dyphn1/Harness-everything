const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'cli.js');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-roundtrip-ws-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-roundtrip-home-'));
const prompts = path.join(home, 'vscode-prompts');

function fail(message, detail = '') {
  console.error(`❌ ${message}${detail ? `\n   ${detail}` : ''}`);
  cleanup();
  process.exit(1);
}

function check(message, condition, detail = '') {
  if (!condition) fail(message, detail);
  console.log(`✅ ${message}`);
}

function write(rel, content) {
  const target = path.join(ws, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function run(args) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    VSCODE_USER_PROMPTS_FOLDER: prompts,
  };
  return spawnSync(process.execPath, [cli, ...args], { cwd: ws, env, encoding: 'utf8' });
}

function cleanup() {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}

fs.mkdirSync(path.join(ws, '.git'), { recursive: true });

const seeded = new Map([
  ['.claude/settings.json', JSON.stringify({ customSetting: true, permissions: { allow: ['Bash(git status)'] } }, null, 2)],
  ['.cursorrules', 'user cursor rule\n'],
  ['.github/copilot-instructions.md', 'user copilot instruction\n'],
  ['AGENTS.md', 'user codex instruction\n'],
  ['.hermes.md', 'user hermes context\n'],
  ['.continue/rules/user.md', '# user continue rule\n'],
]);
for (const [rel, content] of seeded) write(rel, content);

const customSkill = write(
  '.agents/skills/custom-user-skill/SKILL.md',
  '---\nname: custom-user-skill\ndescription: user owned\nmetadata:\n  author: Someone Else\n  version: 1.0.0\n---\n# User skill\n'
);

const install = run(['install', '--all', '--copy', '-y']);
check('install --all --copy succeeds', install.status === 0, `${install.stdout}\n${install.stderr}`);
const verify = run(['verify-install']);
check('verify-install succeeds after installation', verify.status === 0, `${verify.stdout}\n${verify.stderr}`);

const targetChecks = [
  '.claude/skills/tdd/SKILL.md',
  '.cursor/skills/tdd/SKILL.md',
  '.github/skills/tdd/SKILL.md',
  '.agents/skills/tdd/SKILL.md',
  '.continue/skills/tdd/SKILL.md',
];
for (const rel of targetChecks) check(`installed ${rel}`, fs.existsSync(path.join(ws, rel)));
check('Hermes/Codex shared project skill is discoverable through .agents/skills', fs.existsSync(path.join(ws, '.agents', 'skills', 'tdd', 'SKILL.md')));
check('user-owned shared skill survives install', fs.existsSync(customSkill));

const uninstall = run(['uninstall', '--local', '--skills', '-y']);
check('uninstall --local --skills succeeds', uninstall.status === 0, `${uninstall.stdout}\n${uninstall.stderr}`);

for (const [rel, expected] of seeded) {
  const target = path.join(ws, rel);
  check(`restored pre-existing ${rel}`, fs.existsSync(target) && fs.readFileSync(target, 'utf8') === expected,
    fs.existsSync(target) ? JSON.stringify(fs.readFileSync(target, 'utf8')) : 'file missing');
}
check('Harness Continue rule is removed', !fs.existsSync(path.join(ws, '.continue', 'rules', 'harness.md')));
check('user-owned shared skill survives uninstall', fs.existsSync(customSkill));

for (const rel of targetChecks) check(`removed Harness skill ${rel}`, !fs.existsSync(path.join(ws, rel)));

const ownedHarnessDirs = [
  '.claude/harness-everything',
  '.cursor/harness-everything',
  '.github/harness-everything',
  '.codex/harness-everything',
  '.continue/harness-everything',
  '.hermes/harness-everything',
];
for (const rel of ownedHarnessDirs) check(`no orphaned ${rel}`, !fs.existsSync(path.join(ws, rel)));

cleanup();
console.log('\nInstaller round-trip: PASSED');
