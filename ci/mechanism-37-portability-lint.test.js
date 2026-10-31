const assert = require('assert');
const { analyzeLiteral } = require('./portability-lint');

// Corpus for the portability classifier. Every Windows-hostile example is
// built at runtime from portable fragments, so this file itself passes the
// lint it tests (the lint scans all of ci/).

const BACKSLASH = String.fromCharCode(92);
const COLON = ':';
const QUOTE = String.fromCharCode(34);
const STAR = '*';
const nul = ['n', 'u', 'l'].join('');

const POSITIVES = [
  { label: 'colon in filename', value: ['bad', 'name.md'].join(COLON), rule: 'WIN_INVALID_CHAR' },
  { label: 'star in filename', value: ['bad', 'name.md'].join(STAR), rule: 'WIN_INVALID_CHAR' },
  { label: 'quote in filename', value: ['bad', 'name.md'].join(QUOTE), rule: 'WIN_INVALID_CHAR' },
  { label: 'bare reserved name', value: nul.toUpperCase(), rule: 'WIN_RESERVED_NAME' },
  { label: 'reserved name with extension', value: `${nul}.txt`, rule: 'WIN_RESERVED_NAME' },
  {
    label: 'colon inside a drive-absolute path',
    value: [`C${COLON}`, 'dir', ['bad', 'name.md'].join(COLON)].join(BACKSLASH),
    rule: 'WIN_INVALID_CHAR',
  },
  {
    label: 'reserved path segment',
    value: ['docs', `${nul}.md`].join('/'),
    rule: 'WIN_RESERVED_NAME',
  },
  {
    label: 'device namespace path',
    value: [BACKSLASH, BACKSLASH, '.', BACKSLASH].join('') + nul,
    rule: 'WIN_DEVICE_PATH',
  },
];

const NEGATIVES = [
  { label: 'node specifier', value: 'node:assert/strict' },
  { label: 'https URL with port', value: 'https://example.com/a:b' },
  { label: 'pkg purl', value: 'pkg:npm/left-pad@1.0.0' },
  { label: 'git tree-ish selector', value: 'HEAD:refs/heads/main' },
  { label: 'doc provenance tag', value: 'legacy:GRAPH-1@docs/adr/legacy.md' },
  { label: 'identity tag', value: 'human:someone@example.com' },
  { label: 'double-star glob', value: 'docs/prd/**' },
  { label: 'single-star glob', value: 'references/*.md' },
  { label: 'backslash glob', value: ['docs', 'prd', '**'].join(BACKSLASH) },
  { label: 'placeholder root', value: '<this-skill-dir>/guide.md' },
  { label: 'template prefix', value: '${base}:docs/prd/sample/r001.md' },
  { label: 'clock fragment', value: '10:06' },
  { label: 'spaced prose with colon', value: 'fixture group: control' },
  { label: 'regex source with char class', value: '/[^"\\s]+\\.js' },
  { label: 'regex source with inline group', value: '(?:<[^>]+>/)?[A-Za-z0-9_.-]+\\.md' },
  { label: 'plain relative path', value: './src/app.js' },
  { label: 'portable fixture name', value: 'fixtures/planning-v2.md' },
];

for (const { label, value, rule } of POSITIVES) {
  const rules = new Set(analyzeLiteral({ value }).map((finding) => finding.rule));
  assert.ok(rules.has(rule), `expected ${rule} for ${label}, got: ${[...rules].join(', ') || '(none)'}`);
}

for (const { label, value } of NEGATIVES) {
  const findings = analyzeLiteral({ value });
  assert.deepStrictEqual(
    findings,
    [],
    `expected no findings for ${label}, got: ${findings.map((f) => `${f.rule} (${f.detail})`).join('; ')}`,
  );
}

console.log(`mechanism-37-portability-lint: ${POSITIVES.length} positive and ${NEGATIVES.length} negative corpus cases hold`);
