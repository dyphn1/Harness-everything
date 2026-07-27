const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2h] Installer manifest and skill bookkeeping...');

const manifestMockWs = helper.tempDir('.mechanism-test-manifest-ws');
fs.mkdirSync(manifestMockWs, { recursive: true });

const manifestHelper = require('../scripts/lib/manifest');
const skillsHelper = require('../scripts/lib/skills');
const testManifestPath = path.join(manifestMockWs, 'manifest.json');

// 1. Verify readManifest of non-existent path
const initialManifest = manifestHelper.readManifest(testManifestPath);
helper.check(
  '2h. readManifest returns fallback structure when file does not exist',
  initialManifest.package === 'harness-everything' && Array.isArray(initialManifest.skills) && initialManifest.skills.length === 0,
  `Got: ${JSON.stringify(initialManifest)}`
);

// 2. Verify recordSkillInstall writes and serializes correctly
manifestHelper.recordSkillInstall(testManifestPath, '1.0.0', 'test-skill', '/path/to/test-skill');
const writtenManifest = manifestHelper.readManifest(testManifestPath);
helper.check(
  '2h. recordSkillInstall successfully records skill information',
  writtenManifest.version === '1.0.0' &&
    writtenManifest.skills.length === 1 &&
    writtenManifest.skills[0].id === 'test-skill' &&
    writtenManifest.skills[0].dirPath === '/path/to/test-skill',
  `Got: ${JSON.stringify(writtenManifest)}`
);

// 3. Verify recordGeneratedSkill and removeGeneratedSkill
manifestHelper.recordGeneratedSkill(testManifestPath, 'gen-skill', '/path/to/gen-skill', 'desc', ['trigger']);
const withGenerated = manifestHelper.readManifest(testManifestPath);
helper.check(
  '2h. recordGeneratedSkill successfully records generated skill with triggers',
  withGenerated.generated &&
    withGenerated.generated.length === 1 &&
    withGenerated.generated[0].id === 'gen-skill' &&
    withGenerated.generated[0].triggers.includes('trigger'),
  `Got: ${JSON.stringify(withGenerated)}`
);

manifestHelper.removeGeneratedSkill(testManifestPath, '/path/to/gen-skill');
const afterRemoveGen = manifestHelper.readManifest(testManifestPath);
helper.check(
  '2h. removeGeneratedSkill removes generated skill correctly',
  afterRemoveGen.generated && afterRemoveGen.generated.length === 0,
  `Got: ${JSON.stringify(afterRemoveGen)}`
);

// 4. Verify isHarnessSkillDir matches correct author
const mockSkillPath = path.join(manifestMockWs, 'mock-skill-folder');
fs.mkdirSync(mockSkillPath, { recursive: true });
const mockSkillMdPath = path.join(mockSkillPath, 'SKILL.md');

fs.writeFileSync(mockSkillMdPath, '---\nauthor: Miya Daniel | Harness Core Team\n---\n', 'utf8');
const isHarness = skillsHelper.isHarnessSkillDir(mockSkillPath);
helper.check(
  '2h. isHarnessSkillDir detects Harness author correctly',
  isHarness === true,
  `Expected true but got false`
);

fs.writeFileSync(mockSkillMdPath, '---\nauthor: Outsider\n---\n', 'utf8');
const isNotHarness = skillsHelper.isHarnessSkillDir(mockSkillPath);
helper.check(
  '2h. isHarnessSkillDir returns false for foreign authors',
  isNotHarness === false,
  `Expected false but got true`
);

// 5. Verify removeSkillFromManifest removes skill and deletes empty manifest
manifestHelper.removeSkillFromManifest(testManifestPath, '/path/to/test-skill');
helper.check(
  '2h. removeSkillFromManifest cleans up or unlinks empty manifest',
  !fs.existsSync(testManifestPath),
  `Manifest file still exists after removing all entries!`
);

fs.rmSync(manifestMockWs, { recursive: true, force: true });

helper.finish();
