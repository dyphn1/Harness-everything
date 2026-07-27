const fs = require('fs');
const helper = require('./test-helper');

console.log('\n[2f] Stop gate...');

helper.writeState('handoff-state.json', { status: 'idle', lastEditAt: Date.now(), lastVerifyAt: 0 });
const dirtyFile = helper.tempFile('.mechanism-test-dirty.tmp');
fs.writeFileSync(dirtyFile, 'dirty');
const firstStop = helper.runHook('stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. First stop after an unverified edit bounces (exit=2)',
  firstStop.code === 2 && firstStop.stderr.includes('[Stop Gate]'),
  `Got exit=${firstStop.code}, stderr="${firstStop.stderr.slice(0, 200)}"`
);
const secondStop = helper.runHook('stop-gate.js', { session_id: helper.SESSION_ID });
helper.check(
  '2f. Same edit batch does not bounce twice (exit=0)',
  secondStop.code === 0,
  `Got exit=${secondStop.code}`
);
fs.unlinkSync(dirtyFile);

helper.finish();
