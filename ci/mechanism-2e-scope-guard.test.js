const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2e] Subagent scope guard...');

helper.runHook('subagent-scope-guard.js', {
  session_id: helper.SESSION_ID, tool_name: 'Task', hook_event_name: 'PreToolUse', tool_input: {},
});
const scopeFile = helper.tempFile('.mechanism-test-scope.tmp');
fs.writeFileSync(scopeFile, 'unexpected change');
const scopeResult = helper.runHook('subagent-scope-guard.js', {
  session_id: helper.SESSION_ID, tool_name: 'Task', hook_event_name: 'PostToolUse', tool_input: {},
});
helper.check(
  '2e. Flags the newly-created file after a Task burst (exit=2, lists filename)',
  scopeResult.code === 2 &&
    scopeResult.stderr.includes('Subagent Scope Guard') &&
    scopeResult.stderr.includes(path.basename(scopeFile)),
  `Got exit=${scopeResult.code}, stderr="${scopeResult.stderr.slice(0, 300)}"`
);
fs.unlinkSync(scopeFile);

helper.finish();
