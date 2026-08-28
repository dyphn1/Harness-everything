const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2g] Platform ignore patterns / Gitignore matching...');

const mockWs = helper.tempDir('.mechanism-test-mock-ws');
fs.mkdirSync(mockWs, { recursive: true });

const platforms = require('../hooks/scripts/lib/platforms');
const claudePlatform = platforms.find(p => p.name === 'claude');
const cursorPlatform = platforms.find(p => p.name === 'cursor');

// 1. Claude platform ignore pattern with mixed skills
const claudeSkillsDir = path.join(mockWs, '.claude', 'skills');
fs.mkdirSync(path.join(claudeSkillsDir, 'harness-skill'), { recursive: true });
fs.mkdirSync(path.join(claudeSkillsDir, 'custom-skill'), { recursive: true });

fs.writeFileSync(
  path.join(claudeSkillsDir, 'harness-skill', 'SKILL.md'),
  '---\nauthor: Miya Daniel\n---\n',
  'utf8'
);
fs.writeFileSync(
  path.join(claudeSkillsDir, 'custom-skill', 'SKILL.md'),
  '---\nauthor: Someone Else\n---\n',
  'utf8'
);

const claudePatterns = claudePlatform.getIgnorePatterns(mockWs);
helper.check(
  '2g. getIgnorePatterns returns ONLY Harness skills',
  claudePatterns.includes('.claude/harness-everything/') &&
    claudePatterns.includes('.claude/skills/harness-skill/') &&
    !claudePatterns.includes('.claude/skills/custom-skill/'),
  `Got patterns: ${JSON.stringify(claudePatterns)}`
);

// 2. test isMatch for claude parent matching to avoid double appending
helper.check(
  '2g. isMatch returns true for parent folder match (Claude)',
  claudePlatform.isMatch('.claude/harness-everything/', '.claude') === true &&
    claudePlatform.isMatch('.claude/harness-everything/', '.claude/') === true,
  `isMatch for .claude failed`
);

helper.check(
  '2g. isMatch returns true for exact match of harness skill (Claude)',
  claudePlatform.isMatch('.claude/skills/harness-skill/', '.claude/skills/harness-skill/') === true &&
    claudePlatform.isMatch('.claude/skills/harness-skill/', '.claude/skills/harness-skill') === true,
  `isMatch for exact skill path failed`
);

// 3. Cursor platform ignore pattern with mixed skills
const cursorSkillsDir = path.join(mockWs, '.cursor', 'skills');
fs.mkdirSync(path.join(cursorSkillsDir, 'harness-skill'), { recursive: true });
fs.mkdirSync(path.join(cursorSkillsDir, 'custom-skill'), { recursive: true });

fs.writeFileSync(
  path.join(cursorSkillsDir, 'harness-skill', 'SKILL.md'),
  '---\nauthor: Miya Daniel\n---\n',
  'utf8'
);
fs.writeFileSync(
  path.join(cursorSkillsDir, 'custom-skill', 'SKILL.md'),
  '---\nauthor: Someone Else\n---\n',
  'utf8'
);

const cursorPatterns = cursorPlatform.getIgnorePatterns(mockWs);
helper.check(
  '2g. getIgnorePatterns returns ONLY Harness skills (Cursor)',
  cursorPatterns.includes('.cursor/harness-everything/') &&
    cursorPatterns.includes('.cursor/skills/harness-skill/') &&
    !cursorPatterns.includes('.cursor/skills/custom-skill/'),
  `Got patterns: ${JSON.stringify(cursorPatterns)}`
);

helper.check(
  '2g. isMatch returns true for parent folder match (Cursor)',
  cursorPlatform.isMatch('.cursor/harness-everything/', '.cursor') === true &&
    cursorPlatform.isMatch('.cursor/harness-everything/', '.cursor/') === true,
  `isMatch for .cursor failed`
);

fs.rmSync(mockWs, { recursive: true, force: true });

helper.finish();
