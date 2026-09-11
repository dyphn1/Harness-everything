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

function writeUnder(base, rel, content) {
  const target = path.join(base, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function write(rel, content) {
  return writeUnder(ws, rel, content);
}

function writeHome(rel, content) {
  return writeUnder(home, rel, content);
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

// -------------------------------------------------------------------------
// Local round trip: seed real user files, install all platform integrations
// with physical copies, then verify uninstall returns those bytes exactly.
// -------------------------------------------------------------------------
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
check('local install --all --copy succeeds', install.status === 0, `${install.stdout}\n${install.stderr}`);
const verify = run(['verify-install']);
check('verify-install succeeds after local installation', verify.status === 0, `${verify.stdout}\n${verify.stderr}`);

const targetChecks = [
  '.claude/skills/tdd/SKILL.md',
  '.cursor/skills/tdd/SKILL.md',
  '.github/skills/tdd/SKILL.md',
  '.agents/skills/tdd/SKILL.md',
  '.continue/skills/tdd/SKILL.md',
];
for (const rel of targetChecks) check(`installed ${rel}`, fs.existsSync(path.join(ws, rel)));
check('Hermes/Codex shared project skill is discoverable through .agents/skills', fs.existsSync(path.join(ws, '.agents', 'skills', 'tdd', 'SKILL.md')));
check('user-owned shared skill survives local install', fs.existsSync(customSkill));

const uninstall = run(['uninstall', '--local', '--skills', '-y']);
check('local uninstall --local --skills succeeds', uninstall.status === 0, `${uninstall.stdout}\n${uninstall.stderr}`);

for (const [rel, expected] of seeded) {
  const target = path.join(ws, rel);
  check(`restored pre-existing ${rel}`, fs.existsSync(target) && fs.readFileSync(target, 'utf8') === expected,
    fs.existsSync(target) ? JSON.stringify(fs.readFileSync(target, 'utf8')) : 'file missing');
}
check('Harness Continue rule is removed', !fs.existsSync(path.join(ws, '.continue', 'rules', 'harness.md')));
check('user-owned shared skill survives local uninstall', fs.existsSync(customSkill));
for (const rel of targetChecks) check(`removed Harness skill ${rel}`, !fs.existsSync(path.join(ws, rel)));

const ownedHarnessDirs = [
  '.claude/harness-everything',
  '.cursor/harness-everything',
  '.github/harness-everything',
  '.codex/harness-everything',
  '.continue/harness-everything',
  '.hermes/harness-everything',
];
for (const rel of ownedHarnessDirs) check(`no orphaned local ${rel}`, !fs.existsSync(path.join(ws, rel)));

// -------------------------------------------------------------------------
// Global round trip: prove each host-native user skill root is used and that
// a shared ~/.agents/skills directory can contain unrelated user content.
// -------------------------------------------------------------------------
const seededHome = new Map([
  ['.claude/settings.json', JSON.stringify({ globalUserSetting: true }, null, 2)],
  ['.cursorrules', 'global user cursor rule\n'],
  ['.continue/rules/user.md', '# global user continue rule\n'],
]);
for (const [rel, content] of seededHome) writeHome(rel, content);

const customGlobalSkill = writeHome(
  '.agents/skills/custom-global-skill/SKILL.md',
  '---\nname: custom-global-skill\ndescription: user owned global skill\nmetadata:\n  author: Someone Else\n  version: 1.0.0\n---\n# User global skill\n'
);

const globalInstall = run(['install', '--all', '--global', '--copy', '-y']);
check('global install --all --copy succeeds', globalInstall.status === 0, `${globalInstall.stdout}\n${globalInstall.stderr}`);

const globalTargets = [
  ['Claude global', path.join(home, '.claude', 'skills', 'tdd', 'SKILL.md')],
  ['shared Agent Skills global', path.join(home, '.agents', 'skills', 'tdd', 'SKILL.md')],
  ['Continue global', path.join(home, '.continue', 'skills', 'tdd', 'SKILL.md')],
  ['Hermes global', path.join(home, '.hermes', 'skills', 'tdd', 'SKILL.md')],
];
for (const [label, target] of globalTargets) check(`${label} target contains tdd`, fs.existsSync(target), target);
check('Hermes global ownership marker exists', fs.existsSync(path.join(home, '.agents', 'harness-everything', 'hermes-global.json')));
check('user-owned global Agent Skill survives global install', fs.existsSync(customGlobalSkill));

const globalUninstall = run(['uninstall', '--global', '--skills', '-y']);
check('global uninstall --global --skills succeeds', globalUninstall.status === 0, `${globalUninstall.stdout}\n${globalUninstall.stderr}`);

for (const [rel, expected] of seededHome) {
  const target = path.join(home, rel);
  check(`restored pre-existing global ${rel}`, fs.existsSync(target) && fs.readFileSync(target, 'utf8') === expected,
    fs.existsSync(target) ? JSON.stringify(fs.readFileSync(target, 'utf8')) : 'file missing');
}
check('user-owned global Agent Skill survives global uninstall', fs.existsSync(customGlobalSkill));
for (const [label, target] of globalTargets) check(`${label} Harness skill removed`, !fs.existsSync(target), target);
check('Hermes global ownership marker removed', !fs.existsSync(path.join(home, '.agents', 'harness-everything', 'hermes-global.json')));

for (const rel of ['.claude/harness-everything', '.agents/harness-everything', '.continue/harness-everything', '.hermes/harness-everything']) {
  check(`no orphaned global ${rel}`, !fs.existsSync(path.join(home, rel)));
}

cleanup();
console.log('\nInstaller local + global round-trip: PASSED');
