#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, '.claude-plugin', 'plugin.json');
const conventionalHooksPath = path.join(projectRoot, 'hooks', 'hooks.json');

assert.ok(fs.existsSync(manifestPath), '.claude-plugin/plugin.json must exist');
assert.ok(fs.existsSync(conventionalHooksPath), 'hooks/hooks.json must remain available for convention-based discovery');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const hooks = manifest.hooks;

if (hooks !== undefined) {
  const refs = Array.isArray(hooks) ? hooks : [hooks];
  const normalized = refs
    .filter(ref => typeof ref === 'string')
    .map(ref => ref.replace(/\\/g, '/').replace(/^\.\//, ''));

  assert.ok(
    !normalized.includes('hooks/hooks.json'),
    'Do not explicitly register hooks/hooks.json in .claude-plugin/plugin.json; Claude Code auto-discovers the conventional hook file and duplicate registration prevents the plugin from loading.'
  );
}

console.log('PASS: Claude plugin manifest does not duplicate the conventional hooks/hooks.json registration.');
