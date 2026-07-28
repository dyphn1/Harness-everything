#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadManifestHelper() {
  const candidates = [
    path.join(__dirname, '../../scripts/lib/manifest'),
    path.join(__dirname, '../scripts/lib/manifest'),
    path.join(__dirname, '../../../scripts/lib/manifest'),
    path.join(getWorkspaceRoot(), 'scripts/lib/manifest'),
    path.join(getWorkspaceRoot(), 'harness-everything/scripts/lib/manifest'),
  ];
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand + '.js') || fs.existsSync(cand)) {
        return require(cand);
      }
    } catch (e) {}
  }
  throw new Error('[register-dynamic-skill] Failed to locate manifest helper module (scripts/lib/manifest)');
}

const { getManifestPath, readManifest, writeManifest, recordGeneratedSkill } = loadManifestHelper();

// Find user home folder
const userHome = process.env.HOME || process.env.USERPROFILE || '';
const workspaceRoot = getWorkspaceRoot();

// List of all possible manifest.json home paths
const manifestHomes = [
  path.join(workspaceRoot, '.claude'),
  path.join(workspaceRoot, '.cursor'),
  path.join(workspaceRoot, '.github'),
  path.join(workspaceRoot, '.codex'),
  path.join(workspaceRoot, '.continue'),
  path.join(userHome, '.agents'),
  path.join(userHome, '.claude')
];

// Helper to parse simple YAML frontmatter without external dependencies
function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  const fm = {};
  let inFM = false;
  const fmLines = [];
  
  for (const line of lines) {
    if (line.trim() === '---') {
      if (!inFM) {
        inFM = true;
        continue;
      } else {
        break;
      }
    }
    if (inFM) {
      fmLines.push(line);
    }
  }

  let currentKey = null;
  for (const line of fmLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check if indent level is substantial (nested list or object)
    const indent = line.search(/\S/);
    
    if (indent === 0) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (match) {
        const key = match[1];
        const val = match[2].trim();
        
        let cleanVal = val;
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          cleanVal = val.slice(1, -1);
        }
        
        if (val.startsWith('[') && val.endsWith(']')) {
          cleanVal = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
        
        fm[key] = cleanVal;
        currentKey = key;
      }
    } else if (indent > 0 && currentKey) {
      // Handle nested properties or array items
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(fm[currentKey])) {
          fm[currentKey] = [];
        }
        fm[currentKey].push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, ''));
      } else {
        const childMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (childMatch) {
          if (typeof fm[currentKey] !== 'object' || Array.isArray(fm[currentKey])) {
            fm[currentKey] = {};
          }
          const childKey = childMatch[1];
          const childVal = childMatch[2].trim().replace(/^['"]|['"]$/g, '');
          fm[currentKey][childKey] = childVal;
        }
      }
    }
  }
  return fm;
}

function processSkillDir(skillDirPath) {
  const skillFile = path.join(skillDirPath, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return null;
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  const fm = parseFrontmatter(content);
  
  const skillId = fm.name || path.basename(skillDirPath);
  const description = fm.description || 'No description provided';
  
  // Extract custom triggers/tags if defined, or infer them from keywords
  let triggers = [];
  if (fm.triggers) {
    triggers = Array.isArray(fm.triggers) ? fm.triggers : [fm.triggers];
  } else if (fm.metadata && fm.metadata.triggers) {
    triggers = Array.isArray(fm.metadata.triggers) ? fm.metadata.triggers : [fm.metadata.triggers];
  } else {
    // Fallback only - explicit `triggers:` frontmatter (mandated by
    // skill-creator/SKILL.md §4) should make this branch rare. Kept
    // deliberately conservative: only the skill name plus the description's
    // first sentence (not the whole prose block), a longer stopword list,
    // and a length-5+ floor, so a generic skill description doesn't spam
    // tier-router.js with broad words that fire on unrelated prompts.
    const firstSentence = description.split(/[.!?]/)[0];
    const STOPWORDS = new Set([
      'with', 'from', 'this', 'that', 'your', 'about', 'some', 'than', 'then',
      'prevent', 'resolved', 'skill', 'agent', 'using', 'which', 'these',
      'those', 'their', 'there', 'where', 'when', 'while', 'after', 'before',
      'again', 'other', 'every', 'being', 'would', 'could', 'should', 'still',
      'first', 'never', 'always', 'ensure', 'provide', 'provided'
    ]);
    const words = (skillId + ' ' + firstSentence)
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 5 && !STOPWORDS.has(w));
    triggers = [...new Set(words)].slice(0, 8);
  }

  return {
    id: skillId,
    dirPath: skillDirPath,
    description,
    triggers,
    metadata: fm.metadata || {}
  };
}

function register() {
  const arg = process.argv[2];
  const generatedBaseDir = path.join(workspaceRoot, '.claude', 'harness-everything', 'skills', 'generated');
  
  let skillsToRegister = [];

  if (arg) {
    // Scenario A: Register specific skill ID or path
    let skillPath = arg;
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(generatedBaseDir, arg);
    }
    if (fs.existsSync(skillPath)) {
      const info = processSkillDir(skillPath);
      if (info) skillsToRegister.push(info);
    } else {
      console.error(`[Error] Dynamic skill folder not found: ${arg}`);
      process.exit(1);
    }
  } else {
    // Scenario B: Scan whole generated folder
    if (fs.existsSync(generatedBaseDir)) {
      const subdirs = fs.readdirSync(generatedBaseDir, { withFileTypes: true });
      for (const entry of subdirs) {
        if (entry.isDirectory()) {
          const dirPath = path.join(generatedBaseDir, entry.name);
          const info = processSkillDir(dirPath);
          if (info) skillsToRegister.push(info);
        }
      }
    }
  }

  if (skillsToRegister.length === 0) {
    console.log('[Info] No self-evolved dynamic skills found to register.');
    return;
  }

  // Write to all detected manifests (auto-creating target directories if in workspace)
  let count = 0;
  for (const home of manifestHomes) {
    const manifestPath = getManifestPath(home);
    const parentDir = path.dirname(manifestPath);
    const isRepoHome = home.startsWith(workspaceRoot);
    if (fs.existsSync(parentDir) || isRepoHome) {
      fs.mkdirSync(parentDir, { recursive: true });
      for (const skill of skillsToRegister) {
        recordGeneratedSkill(manifestPath, skill.id, skill.dirPath, skill.description, skill.triggers);
      }
      console.log(`[Success] Registered ${skillsToRegister.length} skill(s) to ${manifestPath}`);
      count++;
    }
  }

  if (count === 0) {
    // Fallback: If no manifest path's directory existed, write to at least the standard home path
    const fallbackHome = path.join(userHome, '.agents');
    const manifestPath = getManifestPath(fallbackHome);
    for (const skill of skillsToRegister) {
      recordGeneratedSkill(manifestPath, skill.id, skill.dirPath, skill.description, skill.triggers);
    }
    console.log(`[Success] Registered ${skillsToRegister.length} skill(s) to fallback manifest ${manifestPath}`);
  }
}

register();
