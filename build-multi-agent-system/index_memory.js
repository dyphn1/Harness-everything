#!/usr/bin/env node
'use strict';

// Compatibility entrypoint. The canonical indexer lives with the merged skill.
const path = require('path');
const { spawnSync } = require('child_process');
const target = path.join(__dirname, '..', 'multi-agent-workspace', 'scripts', 'index_memory.js');
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = result.status === null ? 1 : result.status;
