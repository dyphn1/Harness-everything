#!/usr/bin/env node
/**
 * Boundary Guard (PreToolUse: Grep|Glob|Read)
 * Hard-blocks two concrete sources of context bloat / hallucination risk:
 *   1. Reading a large file whole instead of a scoped chunk (offset/limit).
 *   2. Searching inside known noise directories (node_modules, .git, build
 *      output, etc.) that produce huge, low-signal result sets.
 * Fails open on any parse/lookup error - never blocks due to a bug here.
 */
const fs = require('fs');

const MAX_BYTES_WITHOUT_LIMIT = 512 * 1024; // 512KB
const NOISE_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', 'target', 'vendor', '__pycache__', '.venv', 'coverage'];

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    const toolName = payload.tool_name;
    const input = payload.tool_input || {};

    if (toolName === 'Read') {
      const filePath = input.file_path;
      if (filePath && !input.limit && fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size > MAX_BYTES_WITHOUT_LIMIT) {
          console.error(`[Boundary Guard] BLOCKED: "${filePath}" is ${(stat.size / 1024).toFixed(0)}KB.`);
          console.error(`Reading a file this large in one call risks context bloat and "lost in the middle" degradation.`);
          console.error(`Re-issue the Read with an explicit "offset"/"limit" to pull a targeted slice, or use Grep to locate the relevant section first.`);
          process.exit(2);
        }
      }
    }

    if (toolName === 'Grep' || toolName === 'Glob') {
      const searchPath = input.path || '';
      const pattern = input.pattern || '';
      const hitsNoiseDir = NOISE_DIRS.some(dir => {
        const asPathSegment = new RegExp(`(^|[\\\\/])${dir}($|[\\\\/])`);
        return asPathSegment.test(searchPath) || asPathSegment.test(pattern);
      });
      if (hitsNoiseDir) {
        console.error(`[Boundary Guard] BLOCKED: search targets a noise directory (${NOISE_DIRS.join(', ')}).`);
        console.error(`These produce huge, low-signal result sets and rarely contain what you're actually looking for.`);
        console.error(`Scope the search to source directories instead, or state explicitly why this directory must be searched.`);
        process.exit(2);
      }
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
