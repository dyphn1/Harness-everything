'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'error-handling-map.js');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'error-handling-map-'));
const CANONICAL_MAP = path.join(ROOT, 'docs', 'error-handling', 'nodes.yaml');
const CANONICAL_DIAGRAM = path.join(ROOT, 'docs', 'error-handling', 'README.md');
const ID_A = 'ERR-20261112-a82f647f-c0b1-4c6c-b90b-fb2221fe66bd';
const ID_B = 'ERR-20261112-da72e7fa-a37c-48ab-81b9-a678673a7324';
const ID_C = 'ERR-20261112-ffbb1b17-edb3-4adb-92ff-df76ad8f101c';

const sampleMap = ({ links = '  - { from: A, to: B }', identifierB = ID_B } = {}) => [
  '# Keep this comment through every mutation.',
  'schema: concept-v0',
  'scope: error-handling',
  'actions:',
  '  A:',
  '    identifier: ' + ID_A,
  '    name: Capture',
  '    status: proposed',
  '  B:',
  '    identifier: ' + identifierB,
  '    name: Triage',
  '    status: proposed',
  '  C:',
  '    identifier: ' + ID_C,
  '    name: Identify',
  '    status: retired',
  'links:' + (links === '' ? ' []' : ''),
  ...(links ? [links] : []),
  '',
].join('\n');

const fence = String.fromCharCode(96).repeat(3);
const sampleDiagram = [
  '# View 1',
  '## View 1 — Overall UML Activity Diagram',
  '',
  fence + 'mermaid',
  'flowchart TD',
  '  A["Renamed Capture"] --> MODE{"Decision"}',
  '  A --> MODE',
  '  MODE -->|yes| B((Renamed Triage))',
  '  MODE{"Reused alias label"} --> B',
  fence,
  '',
  '## View 2 — ignored by check',
  fence + 'mermaid',
  'flowchart TD',
  '  A --> C',
  fence,
  '',
].join('\n');

function makeFixture({ map = sampleMap(), diagram = sampleDiagram } = {}) {
  const dir = fs.mkdtempSync(path.join(TEMP, 'case-'));
  const mapPath = path.join(dir, 'nodes.yaml');
  const diagramPath = path.join(dir, 'README.md');
  fs.writeFileSync(mapPath, map);
  fs.writeFileSync(diagramPath, diagram);
  return { dir, mapPath, diagramPath };
}

function invoke(fixture, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, '--map', fixture.mapPath, '--diagram', fixture.diagramPath], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5000,
  });
}

function output(result) {
  return (result.stdout || '') + '\n' + (result.stderr || result.error?.message || '');
}

function assertRejectedUnchanged(fixture, args, diagnostic) {
  const before = fs.readFileSync(fixture.mapPath);
  const result = invoke(fixture, ...args);
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), diagnostic);
  assert.deepEqual(fs.readFileSync(fixture.mapPath), before);
}

after(() => fs.rmSync(TEMP, { recursive: true, force: true }));

test('check accepts the canonical map from the normal repository path', () => {
  const result = spawnSync(process.execPath, [CLI, 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /OK.*Action link/i);
});

test('check derives Action links through non-Action nodes and ignores renamed or reused labels', () => {
  const fixture = makeFixture();
  const result = invoke(fixture, 'check');
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /OK.*Action link/i);
});

test('check rejects dropped, extra and reversed links with actionable diagnostics', () => {
  for (const [links, diagnostics] of [
    ['', [/missing.*A.*B/i]],
    ['  - { from: A, to: B }\n  - { from: A, to: C }', [/extra.*A.*C/i]],
    ['  - { from: B, to: A }', [/missing.*A.*B/i, /extra.*B.*A/i]],
  ]) {
    const fixture = makeFixture({ map: sampleMap({ links }) });
    const result = invoke(fixture, 'check');
    assert.notEqual(result.status, 0, output(result));
    for (const diagnostic of diagnostics) assert.match(output(result), diagnostic);
  }
});

test('new then set-status then check preserves identities and detects later drift', () => {
  const alias = 'I';
  const dir = fs.mkdtempSync(path.join(TEMP, 'walk-'));
  const mapPath = path.join(dir, 'nodes.yaml');
  const diagramPath = path.join(dir, 'README.md');
  const originalMap = fs.readFileSync(CANONICAL_MAP, 'utf8');
  fs.writeFileSync(mapPath, originalMap);
  fs.copyFileSync(CANONICAL_DIAGRAM, diagramPath);
  const before = yaml.load(originalMap);

  const created = invoke({ mapPath, diagramPath }, 'new', '--alias', alias, '--name', 'New "Action"', '--date', '20261118');
  assert.equal(created.status, 0, output(created));
  const id = created.stdout.trim();
  assert.match(id, /^ERR-20261118-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const afterNewText = fs.readFileSync(mapPath, 'utf8');
  const actionBlock = new RegExp(`  ${alias}:\\r?\\n    identifier: ${id}\\r?\\n    name: .*\\r?\\n    status: proposed\\r?\\n`);
  assert.equal(afterNewText.replace(actionBlock, ''), originalMap);
  const afterNew = yaml.load(afterNewText);
  assert.equal(afterNew.actions[alias].identifier, id);
  assert.equal(afterNew.actions[alias].name, 'New "Action"');
  assert.equal(afterNew.actions[alias].status, 'proposed');
  assert.ok(!Object.values(before.actions).some(action => action.identifier === id));
  for (const existingAlias of Object.keys(before.actions)) assert.equal(afterNew.actions[existingAlias].identifier, before.actions[existingAlias].identifier);
  assert.match(fs.readFileSync(mapPath, 'utf8'), /# A-G are drawing-local aliases, NOT identity or ordered numbering\./);
  fs.writeFileSync(diagramPath, fs.readFileSync(diagramPath, 'utf8').replace('    OPEN --> Z((End))', `    OPEN --> Z((End))\n    ${alias}["New Action"]`));

  const statusBefore = fs.readFileSync(mapPath, 'utf8');
  const changed = invoke({ mapPath, diagramPath }, 'set-status', '--id', id, '--status', 'accepted');
  assert.equal(changed.status, 0, output(changed));
  const statusAfter = fs.readFileSync(mapPath, 'utf8');
  const selectedStatus = new RegExp(`(^  ${alias}:\\r?\\n(?:^    [^\\r\\n]*\\r?\\n)*?^    status: )proposed(\\r?$)`, 'm');
  assert.match(statusBefore, selectedStatus);
  assert.equal(statusAfter, statusBefore.replace(selectedStatus, '$1accepted$2'));
  assert.equal(yaml.load(statusAfter).actions[alias].status, 'accepted');

  const valid = invoke({ mapPath, diagramPath }, 'check');
  assert.equal(valid.status, 0, output(valid));
  fs.writeFileSync(mapPath, statusAfter.replace('{ from: A, to: B }', `{ from: A, to: ${alias} }`));
  const drift = invoke({ mapPath, diagramPath }, 'check');
  assert.notEqual(drift.status, 0, output(drift));
  assert.match(output(drift), new RegExp(`missing.*A.*B|extra.*A.*${alias}`, 'i'));
});

test('new rejects a duplicate alias without changing any input bytes', () => {
  const fixture = makeFixture();
  assertRejectedUnchanged(fixture, ['new', '--alias', 'A', '--name', 'Duplicate'], /already exists.*A/i);
  const invalidDate = makeFixture();
  assertRejectedUnchanged(invalidDate, ['new', '--alias', 'H', '--name', 'Invalid date', '--date', '20260230'], /invalid date.*20260230/i);
  const dangling = makeFixture({ map: sampleMap({ links: '  - { from: A, to: Z }' }) });
  assertRejectedUnchanged(dangling, ['new', '--alias', 'H', '--name', 'Must not write'], /unknown Action alias: Z/i);
});

test('new and set-status preserve CRLF input', () => {
  const fixture = makeFixture({
    map: sampleMap().replace(/\n/g, '\r\n'),
    diagram: sampleDiagram.replace(fence + '\n\n## View 2', '  D["New Action"]\n' + fence + '\n\n## View 2').replace(/\n/g, '\r\n'),
  });
  const created = invoke(fixture, 'new', '--alias', 'D', '--name', 'New action', '--date', '20261118');
  assert.equal(created.status, 0, output(created));
  const createdMap = fs.readFileSync(fixture.mapPath, 'utf8');
  assert.doesNotMatch(createdMap, /(^|[^\r])\n/);
  const changed = invoke(fixture, 'set-status', '--id', created.stdout.trim(), '--status', 'accepted');
  assert.equal(changed.status, 0, output(changed));
  assert.doesNotMatch(fs.readFileSync(fixture.mapPath, 'utf8'), /(^|[^\r])\n/);
  const checked = invoke(fixture, 'check');
  assert.equal(checked.status, 0, output(checked));
});

test('set-status changes only the selected Action status line', () => {
  const fixture = makeFixture();
  const before = fs.readFileSync(fixture.mapPath, 'utf8');
  const result = invoke(fixture, 'set-status', '--id', ID_A.toUpperCase(), '--status', 'accepted');
  assert.equal(result.status, 0, output(result));
  const after = fs.readFileSync(fixture.mapPath, 'utf8');
  assert.equal(after.replace('    status: accepted', '    status: proposed'), before);
  const parsed = yaml.load(after);
  assert.equal(parsed.actions.A.status, 'accepted');
  assert.equal(parsed.actions.B.status, 'proposed');
  assert.equal(parsed.actions.C.status, 'retired');
});

test('set-status rejects unknown identifiers and invalid statuses without changing bytes', () => {
  const unknown = makeFixture();
  assertRejectedUnchanged(unknown, ['set-status', '--id', 'ERR-20261118-missing', '--status', 'accepted'], /no Action.*identifier/i);
  const invalid = makeFixture();
  assertRejectedUnchanged(invalid, ['set-status', '--id', ID_A, '--status', 'pending'], /invalid status.*pending/i);
  const duplicate = makeFixture({ map: sampleMap({ identifierB: ID_A.toUpperCase() }) });
  assertRejectedUnchanged(duplicate, ['set-status', '--id', ID_A, '--status', 'accepted'], /duplicate.*identifier/i);
});

test('check rejects duplicate identities and dangling link endpoints', () => {
  const duplicate = makeFixture({ map: sampleMap({ identifierB: ID_A.toUpperCase() }) });
  const duplicateResult = invoke(duplicate, 'check');
  assert.notEqual(duplicateResult.status, 0, output(duplicateResult));
  assert.match(output(duplicateResult), /duplicate.*identifier/i);

  const dangling = makeFixture({ map: sampleMap({ links: '  - { from: A, to: Z }' }) });
  const danglingResult = invoke(dangling, 'check');
  assert.notEqual(danglingResult.status, 0, output(danglingResult));
  assert.match(output(danglingResult), /unknown.*alias.*Z/i);
});

