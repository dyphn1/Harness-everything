#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const pluginSkillsRoot = path.join(ROOT, 'plugins', 'harness-everything', 'skills');

fs.mkdirSync(pluginSkillsRoot, { recursive: true });

const expected = new Set();
for (const entry of manifest.skills || []) {
  const source = path.resolve(ROOT, entry);
  const name = path.basename(source);
  const destination = path.join(pluginSkillsRoot, name);
  expected.add(name);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  console.log(`synced ${name}`);
}

for (const name of fs.readdirSync(pluginSkillsRoot)) {
  if (!expected.has(name)) fs.rmSync(path.join(pluginSkillsRoot, name), { recursive: true, force: true });
}

console.log(`OpenAI plugin skills synchronized: ${expected.size}`);
