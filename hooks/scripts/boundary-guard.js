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
          console.error(`[Boundary Reminder]: "${filePath}" is ${(stat.size / 1024).toFixed(0)}KB.`);
          console.error(`Reading a file this large in one call risks context bloat and "lost in the middle" degradation.`);
          console.error(`SHOULD narrow the read with explicit "offset"/"limit" or use Grep first, unless full-file context is materially required.`);
          process.exit(0);
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
        console.error(`[Boundary Reminder]: search targets a noise directory (${NOISE_DIRS.join(', ')}).`);
        console.error(`These produce huge, low-signal result sets and rarely contain what you're actually looking for.`);
        console.error(`SHOULD scope the search to source directories; if the noisy directory is materially required, state the evidence-based exception.`);
        process.exit(0);
      }
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
