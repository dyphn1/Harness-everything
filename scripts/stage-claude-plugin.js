#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json';

function isSameOrAncestor(candidate, target) {
  const relative = path.relative(candidate, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output.split('\0').filter(Boolean);
}

function stageClaudePlugin(outputDir, options = {}) {
  const outputRoot = path.resolve(outputDir);

  if (isSameOrAncestor(outputRoot, projectRoot)) {
    throw new Error(`Refusing to stage into the repository or one of its parent directories: ${outputRoot}`);
  }

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  let copied = 0;
  for (const relativePath of trackedFiles()) {
    const normalized = relativePath.replace(/\\/g, '/');
    if (normalized === MARKETPLACE_PATH) continue;

    const source = path.join(projectRoot, relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;

    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    copied += 1;
  }

  const pluginManifest = path.join(outputRoot, '.claude-plugin', 'plugin.json');
  const hookManifest = path.join(outputRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(pluginManifest) || !fs.existsSync(hookManifest)) {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    throw new Error('Staged Claude plugin is incomplete: plugin.json or hooks/hooks.json is missing');
  }

  if (!options.quiet) {
    console.log(`Staged ${copied} tracked files for Claude plugin validation at: ${outputRoot}`);
    console.log('Excluded .claude-plugin/marketplace.json so host validation targets the plugin itself.');
  }

  return outputRoot;
}

if (require.main === module) {
  const outputDir = process.argv[2] || path.join(os.tmpdir(), 'harness-everything-claude-plugin');
  try {
    stageClaudePlugin(outputDir);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  stageClaudePlugin,
};
