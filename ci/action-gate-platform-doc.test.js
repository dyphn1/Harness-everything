#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'platform-compatibility.json'), 'utf8'));
const gate = matrix.action_gate;

assert.ok(gate, 'platform compatibility matrix must record action_gate evidence');
assert.strictEqual(gate.mechanism_status, 'Mechanism verified');
assert.strictEqual(gate.rule_table, 'hooks/scripts/action-gate-rules.json');
assert.strictEqual(gate.hosts['claude-code'].ask_decision, 'Mechanism verified');
assert.strictEqual(gate.hosts['claude-code'].permission_mode_matrix, 'Unknown', 'permission-mode behavior must stay Unknown without live-host evidence');
assert.strictEqual(gate.hosts.codex.ask_decision, 'Unknown');
assert.strictEqual(gate.hosts.codex.fallback, 'exit-2-block');
assert.strictEqual(gate.hosts.other.fallback, 'exit-2-block');

const claude = matrix.platforms.find(platform => platform.id === 'claude-code');
assert.ok(claude.official_sources.includes('https://code.claude.com/docs/en/hooks'));
assert.ok(claude.official_sources.includes('https://code.claude.com/docs/en/permissions'));

console.log('Action-gate platform evidence boundary verified.');
