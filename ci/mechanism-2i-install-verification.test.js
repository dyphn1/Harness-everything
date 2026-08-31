const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');
const manifest = require('../scripts/lib/manifest');
const { verifyManifest } = require('../scripts/verify-install');

console.log('\n[2i] Installed version and skill-tree verification...');
const root = helper.tempDir('.mechanism-test-install-verification');
const installedRoot = path.join(root, 'skills');
const installedSkill = path.join(installedRoot, 'tdd');
const manifestPath = path.join(root, 'harness-everything', 'manifest.json');
fs.mkdirSync(installedRoot, { recursive: true });
fs.cpSync(path.join(__dirname, '..', 'tdd'), installedSkill, { recursive: true });
manifest.recordSkillInstall(manifestPath, require('../package.json').version, 'tdd', installedSkill);

let result = verifyManifest(manifestPath, installedRoot);
helper.check('2i. matching version and tree pass', result.failures.length === 0, result.failures.join('; '));

fs.appendFileSync(path.join(installedSkill, 'SKILL.md'), '\nlocal drift\n');
result = verifyManifest(manifestPath, installedRoot);
helper.check('2i. modified installed skill is reported stale', result.failures.some(f => f.includes('STALE tree: tdd')), JSON.stringify(result.failures));

const data = manifest.readManifest(manifestPath);
data.version = '0.3.3';
manifest.writeManifest(manifestPath, data);
result = verifyManifest(manifestPath, installedRoot);
helper.check('2i. old package version is reported stale', result.failures.some(f => f.includes('STALE version')), JSON.stringify(result.failures));

fs.rmSync(manifestPath, { force: true });
result = verifyManifest(manifestPath, installedRoot);
helper.check('2i. legacy install without a manifest is reported stale', result.failures.some(f => f.includes('STALE untracked installation')), JSON.stringify(result.failures));

fs.rmSync(root, { recursive: true, force: true });
helper.finish();
