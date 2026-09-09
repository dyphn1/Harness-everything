const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseSimpleYaml } = require('../behavioral-evals/run');
const helper = require('./test-helper');

console.log('\n[2t] Issue #20 regression coverage...');

function runNode(script, args = [], env = process.env) {
  return spawnSync(process.execPath, [path.join(helper.root, script), ...args], {
    cwd: helper.root,
    encoding: 'utf8',
    env,
  });
}

const yamlFixture = 'prompt: |\n  hello\n  world\nnext: value\n';
const expected = { prompt: 'hello\nworld', next: 'value' };
helper.check(
  '2t. behavioral YAML parsing preserves block scalars under CRLF',
  JSON.stringify(parseSimpleYaml(yamlFixture)) === JSON.stringify(expected) &&
    JSON.stringify(parseSimpleYaml(yamlFixture.replace(/\n/g, '\r\n'))) === JSON.stringify(expected),
  JSON.stringify({ lf: parseSimpleYaml(yamlFixture), crlf: parseSimpleYaml(yamlFixture.replace(/\n/g, '\r\n')) })
);

const pluginValidation = runNode('behavioral-evals/run-with-plugin.js', ['validate']);
helper.check(
  '2t. opencode plugin runner validate command exits successfully',
  pluginValidation.status === 0,
  `exit ${pluginValidation.status}\n${pluginValidation.stderr}`
);

const missingWazaEnv = { ...process.env, PATH: '', Path: '' };
const routingWithoutWaza = runNode('ci/routing-check.js', [], missingWazaEnv);
helper.check(
  '2t. routing check gracefully skips when waza is unavailable',
  routingWithoutWaza.status === 0 && /skip/i.test(`${routingWithoutWaza.stdout}\n${routingWithoutWaza.stderr}`),
  `exit ${routingWithoutWaza.status}\n${routingWithoutWaza.stdout}\n${routingWithoutWaza.stderr}`
);

const malformedName = `issue20-malformed-collision-${process.pid}`;
const malformedTarget = path.join(helper.root, malformedName);
fs.cpSync(
  path.join(helper.root, 'ci', 'fixtures', 'bad-frontmatter-colon'),
  malformedTarget,
  { recursive: true }
);
try {
  const collision = runNode('ci/description-collision.js');
  const output = `${collision.stdout}\n${collision.stderr}`;
  helper.check(
    '2t. description collision gate fails closed on malformed YAML',
    collision.status !== 0 && /YAML|frontmatter/i.test(output),
    `exit ${collision.status}\n${output}`
  );
} finally {
  fs.rmSync(malformedTarget, { recursive: true, force: true });
}

const negativeControls = runNode('ci/negative-controls.js');
helper.check(
  '2t. negative controls execute real gates and pass',
  negativeControls.status === 0 && /real gate/i.test(negativeControls.stdout),
  `exit ${negativeControls.status}\n${negativeControls.stdout}\n${negativeControls.stderr}`
);

const rollup = fs.readFileSync(path.join(helper.root, 'docs', 'issue-20-rollup.md'), 'utf8');
const deferredWork = ['baseline-debugging', 'baseline-performance', 'baseline-security-review', 'baseline-simple-bugfix', 'verify-before-done', 'verification-loop', 'zoom-out', 'security-review'];
helper.check(
  '2t. issue rollup records unresolved acceptance work accurately',
  /Issue #20 remains open/.test(rollup) && deferredWork.every(term => rollup.includes(term)),
  'rollup must name the open issue and each deferred baseline/skill item'
);

helper.finish();
