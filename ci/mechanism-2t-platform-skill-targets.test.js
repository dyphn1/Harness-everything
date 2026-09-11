const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2t] Platform-native skill targets + malformed config safety (issue #80)...');

const platforms = require('../hooks/scripts/lib/platforms');
const skills = require('../scripts/lib/skills');
const manifest = require('../scripts/lib/manifest');
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

fs.rmSync(ws, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
helper.finish();
