'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildBom,
  CYCLONEDX_SCHEMA_URL,
  CYCLONEDX_VERSION,
  validateBom,
  writeBom
} = require('../scripts/generate-sbom');

const ROOT = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const releaseConfig = JSON.parse(fs.readFileSync(path.join(ROOT, '.releaserc.json'), 'utf8'));
const execFileSync = childProcess.execFileSync;
const npmCommand = 'npm';

const execPlugin = releaseConfig.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/exec');
assert.ok(execPlugin, 'semantic-release exec plugin is required for SBOM generation');
assert.match(execPlugin[1].prepareCmd, /generate-sbom\.js --output sbom\.cdx\.json --version \$\{nextRelease\.version\}/);
assert.match(execPlugin[1].prepareCmd, /generate-sbom\.js --validate sbom\.cdx\.json --version \$\{nextRelease\.version\}/);

const bom = buildBom(ROOT, {
  version: packageJson.version,
  timestamp: '2026-09-21T00:00:00.000Z',
  serialNumber: 'urn:uuid:00000000-0000-5000-8000-000000000001'
});
assert.doesNotThrow(() => validateBom(bom, packageJson.version));
assert.strictEqual(bom.bomFormat, 'CycloneDX');
assert.strictEqual(bom.$schema, CYCLONEDX_SCHEMA_URL);
assert.strictEqual(bom.specVersion, CYCLONEDX_VERSION);
assert.strictEqual(CYCLONEDX_VERSION, '1.7');
assert.match(bom.serialNumber, /^urn:uuid:/);
assert.strictEqual(bom.metadata.component.version, packageJson.version);
assert.ok(bom.components.length > 0, 'SBOM must include lockfile components');
assert.ok(bom.components.every(component => component.purl.startsWith('pkg:npm/')));
assert.ok(bom.components.some(component => component.name.startsWith('@') && component.purl.includes('%40')), 'scoped npm packages must use valid PURLs');
assert.ok(bom.dependencies.some(entry => entry.ref === `pkg:npm/${packageJson.name}@${packageJson.version}`));

const output = path.join(os.tmpdir(), `harness-sbom-${process.pid}.cdx.json`);
try {
  writeBom(output, ROOT, { version: packageJson.version, timestamp: '2026-09-21T00:00:00.000Z' });
  const written = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.doesNotThrow(() => validateBom(written, packageJson.version));
} finally {
  fs.rmSync(output, { force: true });
}

const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sbom-pack-'));
try {
  fs.cpSync(ROOT, packRoot, {
    recursive: true,
    filter: source => {
      const relative = path.relative(ROOT, source).replace(/\\/g, '/');
      return relative === '' || !['.git', 'node_modules', '.husky', '.mechanism-test-opencode-home', '.mechanism-test-opencode-workspace'].some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));
    }
  });
  const generated = writeBom(path.join(packRoot, 'sbom.cdx.json'), packRoot, { version: packageJson.version, timestamp: '2026-09-21T00:00:00.000Z' });
  const packOutput = execFileSync(npmCommand, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      HUSKY: '0',
      npm_config_ignore_scripts: 'true'
    }
  });
  const jsonStart = packOutput.indexOf('[');
  const jsonEnd = packOutput.lastIndexOf(']');
  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, 'npm pack --json output must include JSON records');
  const records = JSON.parse(packOutput.slice(jsonStart, jsonEnd + 1));
  const files = records.flatMap(record => record.files || []).map(file => file.path);
  assert.ok(files.includes('sbom.cdx.json'), 'npm pack must include the generated SBOM');
  assert.strictEqual(generated.metadata.component.version, packageJson.version);
} finally {
  fs.rmSync(packRoot, { recursive: true, force: true });
}

let tracked = true;
try {
  execFileSync('git', ['ls-files', '--error-unmatch', 'sbom.cdx.json'], { cwd: ROOT, stdio: 'ignore' });
} catch (_) {
  tracked = false;
}
assert.strictEqual(tracked, false, 'release-generated SBOM must remain untracked');

console.log(`CycloneDX SBOM verified: ${bom.components.length} lockfile components and npm pack inclusion.`);
