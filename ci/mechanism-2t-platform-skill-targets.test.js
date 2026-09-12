const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2t] Platform-native skill targets + install ownership safety (issue #80)...');

const platforms = require('../hooks/scripts/lib/platforms');
const skills = require('../scripts/lib/skills');
const manifest = require('../scripts/lib/manifest');
const advisory = require('../scripts/lib/advisory-text');
const root = path.resolve(__dirname, '..');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2t-ws-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2t-home-'));

function platform(name) {
  return platforms.find((entry) => entry.name === name);
}

function copyAndAssert(name, isGlobal, expectedPath) {
  const p = platform(name);
  const target = p.getSkillsTarget({ workspaceRoot: ws, userHome: home, isGlobal, manifest });
  helper.check(
    `2t. ${name} ${isGlobal ? 'global' : 'local'} target is host-discoverable`,
    target && path.resolve(target.path) === path.resolve(expectedPath),
    `got ${target && target.path}; expected ${expectedPath}`
  );
  if (!target) return;
  skills.installSkillsToTargets({
    chosenSkills: ['tdd'],
    targetDirs: [target],
    harnessSourceDir: root,
    packageVersion: '9.9.9',
    linkMode: 'copy',
  });
  helper.check(
    `2t. ${name} ${isGlobal ? 'global' : 'local'} --copy writes a readable SKILL.md`,
    fs.existsSync(path.join(expectedPath, 'tdd', 'SKILL.md')),
    `${path.join(expectedPath, 'tdd', 'SKILL.md')} missing`
  );
}

copyAndAssert('codex', false, path.join(ws, '.agents', 'skills'));
copyAndAssert('continue', true, path.join(home, '.continue', 'skills'));
copyAndAssert('hermes', false, path.join(ws, '.agents', 'skills'));
copyAndAssert('hermes', true, path.join(home, '.hermes', 'skills'));

// Native global manifests must still be discoverable by the uninstaller and
// use the exact `global` sentinel that prevents a local-only bulk sweep from
// deleting user-home skills.
{
  const installed = skills.getInstalledSkills(ws, home);
  const continueGlobal = installed.find(entry => entry.dirPath === path.join(home, '.continue', 'skills', 'tdd'));
  const hermesGlobal = installed.find(entry => entry.dirPath === path.join(home, '.hermes', 'skills', 'tdd'));
  helper.check('2t. Continue native global manifest is discoverable', !!continueGlobal, JSON.stringify(installed));
  helper.check('2t. Hermes native global manifest is discoverable', !!hermesGlobal, JSON.stringify(installed));
  helper.check('2t. native global skill scopes use the protected global sentinel',
    continueGlobal && hermesGlobal && continueGlobal.scope === 'global' && hermesGlobal.scope === 'global',
    JSON.stringify({ continue: continueGlobal && continueGlobal.scope, hermes: hermesGlobal && hermesGlobal.scope }));
}

// Hermes has no global advisory file, so it records an explicit Harness-owned
// bookkeeping marker instead of mutating Hermes config just to make uninstall
// detection possible.
{
  const hermes = platform('hermes');
  const globalHarness = path.join(home, '.agents', 'harness-everything');
  const marker = path.join(globalHarness, 'hermes-global.json');
  hermes.install({
    isGlobal: true,
    targetWorkspaceRoot: path.join(home, '.agents'),
    userHome: home,
    advisory,
  });
  helper.check('2t. Hermes global install writes an owned detection marker', fs.existsSync(marker), marker);
  hermes.uninstall({
    removeLocal: false,
    removeGlobal: true,
    workspaceRoot: ws,
    userHome: home,
    cleanEmptyDirs(dir) {
      try { if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch (e) { /* best effort */ }
    },
  });
  helper.check('2t. Hermes global uninstall removes its detection marker', !fs.existsSync(marker), marker);
}

// A malformed user settings file must never be converted to `{}` and
// overwritten. Installation fails before any mutation and preserves bytes.
{
  const claude = platform('claude');
  const claudeDir = path.join(ws, '.claude');
  const settings = path.join(claudeDir, 'settings.json');
  fs.mkdirSync(claudeDir, { recursive: true });
  const original = '{ malformed user settings\n';
  fs.writeFileSync(settings, original, 'utf8');

  let failedClosed = false;
  try {
    claude.install({
      isGlobal: false,
      targetWorkspaceRoot: ws,
      harnessSourceDir: root,
      packageVersion: '9.9.9',
      claudeHooks: { mergeHarnessHooks() {} },
      manifest,
    });
  } catch (error) {
    failedClosed = /Refusing to modify malformed/.test(error.message);
  }

  helper.check('2t. malformed Claude settings fail closed', failedClosed, 'install did not reject malformed JSON');
  helper.check(
    '2t. malformed Claude settings remain byte-for-byte unchanged',
    fs.readFileSync(settings, 'utf8') === original,
    `got ${JSON.stringify(fs.readFileSync(settings, 'utf8'))}`
  );
}

// Dedicated/fixed filenames must not let Harness claim or delete an unrelated
// pre-existing user file merely because the path matches.
{
  const continueRule = path.join(ws, '.continue', 'rules', 'harness.md');
  fs.mkdirSync(path.dirname(continueRule), { recursive: true });
  const original = '# user-owned rule\n';
  fs.writeFileSync(continueRule, original, 'utf8');
  let rejected = false;
  try {
    advisory.installContinueRule(continueRule, '.continue/rules/harness.md');
  } catch (error) {
    rejected = /Refusing to overwrite pre-existing non-Harness/.test(error.message);
  }
  helper.check('2t. Continue refuses to overwrite a user-owned harness.md', rejected, 'collision was not rejected');
  helper.check('2t. Continue collision leaves original bytes unchanged', fs.readFileSync(continueRule, 'utf8') === original, 'user rule changed');
}

{
  const promptsDir = path.join(home, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  const getUserPromptsDir = () => promptsDir;
  const cases = [
    ['copilot', 'harness.instructions.md'],
    ['codex', 'harness.agent.md'],
  ];
  for (const [name, fileName] of cases) {
    const p = platform(name);
    const target = path.join(promptsDir, fileName);
    const original = `user-owned ${name}\n`;
    fs.writeFileSync(target, original, 'utf8');
    let rejected = false;
    try {
      p.install({ isGlobal: true, targetWorkspaceRoot: ws, getUserPromptsDir, advisory });
    } catch (error) {
      rejected = /Refusing to overwrite pre-existing non-Harness/.test(error.message);
    }
    helper.check(`2t. ${name} global install refuses a user-owned fixed prompt file`, rejected, 'collision was not rejected');
    p.uninstall({ removeLocal: false, removeGlobal: true, workspaceRoot: ws, userHome: home, getUserPromptsDir, cleanEmptyDirs() {} });
    helper.check(`2t. ${name} global uninstall preserves non-Harness file`, fs.readFileSync(target, 'utf8') === original, 'user-owned file was changed or deleted');
  }
}

fs.rmSync(ws, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
helper.finish();
