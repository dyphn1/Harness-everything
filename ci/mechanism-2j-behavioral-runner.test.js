const helper = require('./test-helper');
const { buildEngineInvocation } = require('../behavioral-evals/run');

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

helper.finish();
