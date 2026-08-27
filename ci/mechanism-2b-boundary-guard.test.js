const fs = require('fs');
const helper = require('./test-helper');

console.log('\n[2b] Boundary guard...');

const bigFile = helper.tempFile('.mechanism-test-big.tmp');
fs.writeFileSync(bigFile, 'x'.repeat(600 * 1024));
const boundaryResult = helper.runHook('boundary-guard.js', { tool_name: 'Read', tool_input: { file_path: bigFile } });
helper.check(
  '2b. Blocks a 600KB Read without limit/offset (exit=2, BLOCKED)',
  boundaryResult.code === 2 && boundaryResult.stderr.includes('[Boundary Guard] BLOCKED'),
  `Got exit=${boundaryResult.code}, stderr="${boundaryResult.stderr.slice(0, 200)}"`
);
fs.unlinkSync(bigFile);

helper.finish();
