const helper = require('./test-helper');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildEngineInvocation, buildWorkspace } = require('../behavioral-evals/run');

console.log('\n[2j] Behavioral runner argv integrity...');
const prompt = "Add punctuation stripping to slug.js, then run npm test. Do not truncate this request.";
for (const engine of ['opencode', 'claude']) {
  const invocation = buildEngineInvocation(engine, prompt, 'C:/fixture with spaces', 16);
  helper.check(
    `2j. ${engine} receives the complete prompt as one argv value`,
    invocation.args.includes(prompt),
    JSON.stringify(invocation.args)
  );
}

const baseline = buildEngineInvocation('claude', prompt, 'C:/fixture with spaces', 16, 'baseline');
helper.check('2j. Claude baseline excludes user customizations', baseline.args.includes('--safe-mode') && baseline.args.includes('--setting-sources') && baseline.args.includes('project,local'), JSON.stringify(baseline.args));
const treatment = buildEngineInvocation('claude', prompt, 'C:/fixture with spaces', 16, 'treatment');
helper.check('2j. Claude treatment keeps only project/local customizations', treatment.args.includes('--setting-sources') && treatment.args.includes('project,local') && !treatment.args.includes('--safe-mode'), JSON.stringify(treatment.args));
helper.check('2j. Claude emits parseable verbose stream JSON', treatment.args.includes('--output-format') && treatment.args.includes('stream-json') && treatment.args.includes('--verbose') && !treatment.args.includes('json'), JSON.stringify(treatment.args));

let validWorkspace = null;
try {
  validWorkspace = buildWorkspace({
    id: 'fixture-valid',
    fixture: { files: [{ path: 'nested/fixture.txt', content: 'fixture smoke proof' }] },
  });
  helper.check(
    '2j. behavioral workspace builder accepts a valid nested fixture through the public execution contract',
    fs.readFileSync(path.join(validWorkspace, 'nested', 'fixture.txt'), 'utf8') === 'fixture smoke proof\n',
    validWorkspace
  );
} catch (error) {
  helper.check(
    '2j. behavioral workspace builder accepts a valid nested fixture through the public execution contract',
    false,
    error && error.stack ? error.stack : String(error)
  );
} finally {
  if (validWorkspace) fs.rmSync(validWorkspace, { recursive: true, force: true });
}

const traversalTarget = path.join(os.tmpdir(), `harness-behavioral-traversal-${process.pid}-${Date.now()}.txt`);
let traversalError = null;
try {
  buildWorkspace({ id: 'fixture-traversal', fixture: { files: [{ path: `../${path.basename(traversalTarget)}`, content: 'path traversal proof' }] } });
} catch (error) {
  traversalError = error;
}
helper.check(
  '2j. behavioral fixtures reject traversal for the expected boundary reason',
  Boolean(
    traversalError &&
    /path must stay inside the generated workspace/.test(traversalError.message) &&
    !fs.existsSync(traversalTarget)
  ),
  traversalError && traversalError.stack ? traversalError.stack : traversalTarget
);

helper.finish();
