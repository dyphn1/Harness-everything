#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  function visit(dir, relative = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      hash.update(`${entry.isDirectory() ? 'D' : 'F'}:${rel}\0`);
      if (entry.isDirectory()) visit(full, rel);
      else if (entry.isFile()) hash.update(fs.readFileSync(full));
    }
  }
  visit(root);
  return hash.digest('hex');
}

const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-sync-'));
const copyRoot = path.join(tempBase, 'repo');

try {
  fs.cpSync(ROOT, copyRoot, {
    recursive: true,
    filter(source) {
      const rel = path.relative(ROOT, source).replace(/\\/g, '/');
      if (!rel) return true;
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.harness' || rel.startsWith('.harness/')
      );
    },
  });

  const pluginRoot = path.join(copyRoot, 'plugins', 'harness-everything');
  const before = treeDigest(pluginRoot);
  const run = spawnSync(process.execPath, [path.join(copyRoot, 'scripts', 'sync-openai-plugin.js')], {
    cwd: copyRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(run.status, 0, `plugin:sync equivalent failed:\n${run.stdout}\n${run.stderr}`);
  const after = treeDigest(pluginRoot);
  assert.strictEqual(after, before, 'sync-openai-plugin.js must be idempotent against the committed plugin package');

  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  const referenced = new Set();
  for (const groups of Object.values(hooks.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        for (const field of ['command', 'commandWindows']) {
          const command = hook[field];
          if (typeof command !== 'string') continue;
          const match = command.match(/(?:\$PLUGIN_ROOT|%PLUGIN_ROOT%)[\\/]([^"']+)/);
          if (match) referenced.add(match[1].replace(/\\/g, '/'));
        }
      }
    }
  }
  for (const relative of referenced) {
    assert.ok(fs.existsSync(path.join(pluginRoot, relative)), `sync must preserve every hook target: ${relative}`);
  }

  assert.ok(fs.existsSync(path.join(pluginRoot, 'hooks', 'scripts', 'codex-action-gate-post.js')), 'sync must preserve the Codex PostToolUse adapter');
  assert.ok(fs.existsSync(path.join(pluginRoot, 'hooks', 'scripts', 'codex-permission-request.js')), 'sync must preserve the Codex PermissionRequest adapter');

  console.log('PASS: OpenAI/Codex plugin sync is idempotent and preserves every referenced hook runtime file.');
} finally {
  fs.rmSync(tempBase, { recursive: true, force: true });
}
