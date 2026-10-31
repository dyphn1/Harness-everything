'use strict';

// #383: preserve each consumer's existing glob dialect while fixing only **.
// Source contract: docs/document-lifecycle.md, project-docs configuration;
// harness-everything/references/doc-check.md, derived-view unsupported cases.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LEGS = [
  path.join(ROOT, 'harness-everything', 'scripts'),
  path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts')
];
let failures = 0;
let checks = 0;
function check(name, run) {
  try { run(); checks++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

for (const [legIndex, dir] of LEGS.entries()) {
  const leg = legIndex === 0 ? 'source' : 'packaged';
  for (const name of ['doc-lifecycle', 'doc-obligations', 'doc-check']) {
    const source = fs.readFileSync(path.join(dir, `${name}.js`), 'utf8');
    const declaration = source.match(/function globToRegExp\([^)]*\) \{[\s\S]*?\n\}/);
    assert.ok(declaration, `${name}: matcher declaration exists`);
    const matcher = vm.runInNewContext(`${declaration[0]}; globToRegExp`, {
      normalizePath: value => String(value).replace(/\\/g, '/').replace(/^\.\//, '')
    });
    check(`${leg}/${name}: recursive line terminators, depths and negative controls`, () => {
      for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
        for (const pattern of ['docs/**/*.md', 'docs/**']) {
          assert.strictEqual(matcher(pattern).test(`docs/a${terminator}b/file.md`), true, JSON.stringify({ pattern, terminator }));
        }
      }
      assert.strictEqual(matcher('docs/**/*.md').test('docs/a/b/file.md'), true);
      // doc-check has historically required the explicit slash after **;
      // lifecycle and obligations give **/ zero-depth matching. Keep both.
      assert.strictEqual(matcher('docs/**/*.md').test('docs/file.md'), name !== 'doc-check');
      assert.strictEqual(matcher('docs/**').test('docs/file.md'), true);
      assert.strictEqual(matcher('docs/*.md').test('docs/a/b.md'), false);
      assert.strictEqual(matcher('docs/*.md').test('docs/a\nb.md'), true);
      assert.strictEqual(matcher('docs/**/*.md').test('other/a/file.md'), false);
      assert.strictEqual(matcher('docs/**/*.md').test('docs/a/file.txt'), false);
      assert.strictEqual(matcher('docs.v1/**').test('docsXv1/file.md'), false);
      assert.strictEqual(matcher('docs/?.md').test('docs/a.md'), name === 'doc-check');
      assert.strictEqual(matcher('docs/?.md').test('docs/ab.md'), false);
      assert.strictEqual(matcher('docs/?.md').test('docs/?.md'), true);
    });
  }

  // LF/CR cannot be filesystem names on Windows; the in-memory matrix above
  // covers them there. LS and PS exercise real paths on every supported host.
  const terminators = process.platform === 'win32' ? ['\u2028', '\u2029'] : ['\n', '\r', '\u2028', '\u2029'];
  for (const terminator of terminators) {
    check(`${leg}/consumers: ${JSON.stringify(terminator)} scope and diagnostics`, () => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-383-'));
      try {
        const relative = `docs/a${terminator}b/file.md`;
        const config = {
          governed: [{ path: 'docs/**/*.md', role: 'reference' }, { path: 'docs/**', role: 'adr' }],
          domains: [], legacy: []
        };
        const absolute = path.join(workspace, relative);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, '# Missing status\n');
        const lifecycle = require(path.join(dir, 'doc-lifecycle'));
        const docs = lifecycle.collectDocs(workspace, config);
        assert.deepStrictEqual(docs.map(doc => [doc.path, doc.role]), [[relative, 'reference']], 'first matching scope retains precedence');
        const lint = lifecycle.analyzeDocs(docs, config, { all: true });
        assert.ok(lint.diagnostics.some(item => item.path === relative && item.code === 'missing-status'), 'scoped malformed document is diagnosed');

        const { deriveDocFacts, deriveDocObligations } = require(path.join(dir, 'doc-obligations'));
        const derived = deriveDocFacts({
          base: { files: { [relative]: '---\nstatus: active\n---\nBefore\n' } },
          candidate: { files: { [relative]: '---\nstatus: active\n---\nAfter\n' } }, config
        });
        assert.deepStrictEqual(derived.facts.governedPaths, [relative]);
        const obligation = deriveDocObligations(derived.facts).find(item => item.capability === 'doc-lint');
        assert.strictEqual(obligation.applicability, 'applicable');
        assert.deepStrictEqual(obligation.scope.paths, [relative]);

        fs.writeFileSync(path.join(workspace, 'config.json'), JSON.stringify({ derived: [{ path: 'docs/**/*.md', generator: 'never-run' }] }));
        const result = spawnSync(process.execPath, [path.join(dir, 'doc-check.js'), 'compare-derived',
          '--workspace', workspace, '--config', 'config.json', '--view', relative,
          '--candidate', 'absent.md', '--generation-status', 'ok'], { encoding: 'utf8', cwd: os.tmpdir() });
        assert.strictEqual(result.status, 2, result.stderr);
        const output = JSON.parse(result.stdout);
        assert.strictEqual(output.result, 'unsupported', 'declared recursive glob receives the correct diagnostic');
        assert.strictEqual(output.reason, 'view matches a declared glob; only literal derived paths are supported');
        assert.strictEqual(fs.existsSync(path.join(workspace, 'absent.md')), false, 'no generator or candidate is created');
      } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    });
  }
}

// #383 F1: the doc-reconciliation core mirrors the ** branch; each copy must match line terminators too.
const CORE_LEGS = [
  path.join(ROOT, 'hooks', 'scripts', 'lib', 'doc-reconciliation-core.js'),
  path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib', 'doc-reconciliation-core.js')
];
const binaryRecord = relative => ({ presence: 'present', path: relative, type: 'file', mode: '100644', storedBytes: Buffer.from([0xff, 0xfe, 0x41]) });
for (const [legIndex, corePath] of CORE_LEGS.entries()) {
  const leg = legIndex === 0 ? 'source' : 'packaged';
  const { deriveFiles, semanticRelevance } = require(corePath)._internals;
  const config = { governed: [{ path: 'docs/**/*.md', role: 'reference' }] };
  for (const terminator of ['\n', '\r', ' ', ' ']) {
    const relative = `docs/a${terminator}b/file.md`;
    check(`${leg}/doc-reconciliation-core: ${JSON.stringify(terminator)} is governed by docs/**/*.md`, () => {
      assert.strictEqual(semanticRelevance(relative, config), 'document', JSON.stringify(relative));
    });
    check(`${leg}/doc-reconciliation-core: ${JSON.stringify(terminator)} undecodable record fails closed`, () => {
      assert.throws(() => deriveFiles([binaryRecord(relative)], config), error => error.code === 'inventory-unsupported');
    });
    check(`${leg}/doc-reconciliation-core: ${JSON.stringify(terminator)} negative control (ungoverned path) is not fail-closed`, () => {
      const other = `other/a${terminator}b/file.md`;
      assert.strictEqual(semanticRelevance(other, config), null, JSON.stringify(other));
      assert.deepStrictEqual(deriveFiles([binaryRecord(other)], config), {});
    });
  }
  check(`${leg}/doc-reconciliation-core: positive control docs/ab/file.md fails closed`, () => {
    assert.strictEqual(semanticRelevance('docs/ab/file.md', config), 'document');
    assert.throws(() => deriveFiles([binaryRecord('docs/ab/file.md')], config), error => error.code === 'inventory-unsupported');
  });
}
console.log(`${checks} checks passed; ${failures} failed`);
process.exitCode = failures ? 1 : 0;
