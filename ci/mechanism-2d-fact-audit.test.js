const { execSync } = require('child_process');
const path = require('path');
const helper = require('./test-helper');

console.log('\n[2d] Fact-audit reminder...');

const tierRouterPath = path.join(helper.root, 'harness-everything', 'scripts', 'tier-router.js');
const factAuditOut = execSync(`node "${tierRouterPath}"`, {
  encoding: 'utf8',
  input: JSON.stringify({ prompt: 'what exit code does this hook use by default and is it documented' }),
});
helper.check(
  '2d. tier-router.js reads {"prompt":...} from stdin and emits FACT-AUDIT REMINDER',
  factAuditOut.includes('FACT-AUDIT REMINDER'),
  `Output was:\n${factAuditOut.slice(0, 300)}`
);

helper.finish();
