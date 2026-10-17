const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const helper = require('./test-helper');
const resolverPath = path.join(__dirname, '..', 'multi-agent-workspace', 'scripts', 'project-docs-resolver.js');
const toSpecResolverPath = path.join(__dirname, '..', 'to-spec', 'scripts', 'project-docs-resolver.js');
const toSpecCheckPath = path.join(__dirname, '..', 'to-spec', 'scripts', 'check-project-docs.js');
const resolver = require(resolverPath);
const toSpecResolver = require(toSpecResolverPath);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2aw-project-docs-'));
const PROJECT_CONFIG = ['.agents', 'harness-everything', 'project-docs.json'];
const HOSTS = Object.freeze({
  claude: '.claude',
  cursor: '.cursor',
  github: '.github',
  codex: '.codex',
  continue: '.continue'
});

process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));

console.log('\n[2aw] project-docs.json configuration loader...');

function workspace(name) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function configPath(root) {
  return path.join(root, ...PROJECT_CONFIG);
}

function writeProjectConfig(root, value, raw) {
  const file = configPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, raw === undefined ? JSON.stringify(value, null, 2) : raw, 'utf8');
  return file;
}

function writeHostConfig(root, host, value, raw) {
  const home = HOSTS[host];
  if (!home) throw new Error(`unknown fixture host: ${host}`);
  const file = path.join(root, home, 'harness-everything', 'manifest.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, raw === undefined ? JSON.stringify({ projectDocs: value }, null, 2) : raw, 'utf8');
  return file;
}

function relative(root, file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function warningCodes(result) {
  return (result.warnings || []).map(item => typeof item === 'string' ? item : item.code);
}

function diagnosticCodes(result) {
  return (result.diagnostics || []).map(item => typeof item === 'string' ? item : item.code);
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.stack ? error.stack : String(error));
  }
}

const resolveDocsConfig = resolver.resolveDocsConfig;
const validConfig = {
  governed: [{ path: 'docs/prd/**', role: 'prd' }],
  domains: ['GRPH', 'IFCE'],
  legacy: ['docs/adr/legacy/**'],
  derived: [{ path: 'docs/roadmap/index.md', generator: 'npm run docs:index' }],
  tickets: 'tracker'
};

checkCase('2aw. project file wholly overrides a differing host config and warns', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('project-overrides-host');
  const host = {
    governed: [{ path: 'docs/old/**', role: 'reference' }],
    domains: ['GRPH'],
    legacy: ['old/**'],
    tickets: 'tasks/tickets'
  };
  const project = {
    governed: [{ path: 'docs/new/**', role: 'prd' }],
    domains: ['IFCE'],
    tickets: 'tracker'
  };
  const projectFile = writeProjectConfig(root, project);
  writeHostConfig(root, 'claude', host);
  const result = resolveDocsConfig(root, { activeHost: 'claude' });
  assert.strictEqual(result.status, 'project');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.deepStrictEqual(result.config, project);
  assert.ok(!Object.prototype.hasOwnProperty.call(result.config, 'legacy'), 'host-only field must not merge');
  assert.ok(warningCodes(result).includes('project-overrides-host'));
});

checkCase('2aw. identical project and host configs do not warn despite key order and whitespace', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('project-matches-host');
  const host = { governed: validConfig.governed, domains: validConfig.domains, legacy: validConfig.legacy, derived: validConfig.derived, tickets: validConfig.tickets };
  const project = { tickets: 'tracker', derived: validConfig.derived, legacy: validConfig.legacy, domains: validConfig.domains, governed: validConfig.governed };
  const projectFile = writeProjectConfig(root, null, ` {\n  "tickets" : "tracker",\n  "derived" : ${JSON.stringify(project.derived)},\n  "legacy" : ${JSON.stringify(project.legacy)},\n  "domains" : ${JSON.stringify(project.domains)},\n  "governed" : ${JSON.stringify(project.governed)}\n}\n`);
  writeHostConfig(root, 'codex', host);
  const result = resolveDocsConfig(root, { activeHost: 'codex' });
  assert.strictEqual(result.status, 'project');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.ok(!warningCodes(result).includes('project-overrides-host'));
});

checkCase('2aw. invalid JSON project config is invalid and never falls back to host', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('invalid-json');
  const projectFile = writeProjectConfig(root, null, '{ broken json');
  writeHostConfig(root, 'claude', validConfig);
  const result = resolveDocsConfig(root, { activeHost: 'claude' });
  assert.strictEqual(result.status, 'invalid');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.strictEqual(result.config, null);
  assert.ok(result.diagnostics.length > 0);
});

checkCase('2aw. schema-invalid project config is invalid and never falls back to host', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('invalid-schema');
  const projectFile = writeProjectConfig(root, { ...validConfig, governed: [{ path: 'docs/**', role: 'memo' }] });
  writeHostConfig(root, 'claude', validConfig);
  const result = resolveDocsConfig(root, { activeHost: 'claude' });
  assert.strictEqual(result.status, 'invalid');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.strictEqual(result.config, null);
  assert.ok(diagnosticCodes(result).includes('invalid-governed-role'));
});

checkCase('2aw amendment 1. project domains string is a schema error', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('project-domains-string');
  const projectFile = writeProjectConfig(root, { ...validConfig, domains: 'records/domains' });
  const result = resolveDocsConfig(root);
  assert.strictEqual(result.status, 'invalid');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.ok(diagnosticCodes(result).includes('invalid-domains'));
});

checkCase('2aw. project schema accepts all governed roles and warns on unknown keys', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('valid-schema');
  const project = {
    governed: ['prd', 'adr', 'ticket', 'reference', 'log', 'report'].map(role => ({ path: `docs/${role}/**`, role })),
    domains: ['GRPH', 'IFCE'],
    legacy: ['docs/archive/**'],
    derived: [{ path: 'docs/index.md', generator: 'node scripts/build-index.js' }],
    tickets: 'tasks/tickets',
    futureSetting: true
  };
  writeProjectConfig(root, project);
  const result = resolveDocsConfig(root);
  assert.strictEqual(result.status, 'project');
  assert.deepStrictEqual(result.config, project);
  assert.ok(warningCodes(result).includes('unknown-config-key'));
});

checkCase('2aw. domains must match the declared format and be unique', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const malformed = workspace('invalid-domain-format');
  writeProjectConfig(malformed, { ...validConfig, domains: ['G'] });
  assert.strictEqual(resolveDocsConfig(malformed).status, 'invalid');
  const duplicate = workspace('duplicate-domain');
  writeProjectConfig(duplicate, { ...validConfig, domains: ['GRPH', 'GRPH'] });
  assert.strictEqual(resolveDocsConfig(duplicate).status, 'invalid');
});

checkCase('2aw. derived entries require non-empty path and generator strings', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('invalid-derived');
  writeProjectConfig(root, { ...validConfig, derived: [{ path: 'docs/index.md', generator: '' }] });
  const result = resolveDocsConfig(root);
  assert.strictEqual(result.status, 'invalid');
  assert.ok(diagnosticCodes(result).includes('invalid-derived-entry'));
});

checkCase('2aw. tickets accepts tracker or a repo-relative path and rejects absolute paths', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const tracker = workspace('tickets-tracker');
  writeProjectConfig(tracker, { ...validConfig, tickets: 'tracker' });
  assert.strictEqual(resolveDocsConfig(tracker).status, 'project');
  const relativePath = workspace('tickets-path');
  writeProjectConfig(relativePath, { ...validConfig, tickets: 'tasks/tickets' });
  assert.strictEqual(resolveDocsConfig(relativePath).status, 'project');
  const absolutePath = workspace('tickets-absolute');
  writeProjectConfig(absolutePath, { ...validConfig, tickets: path.resolve(tempRoot, 'tickets') });
  assert.strictEqual(resolveDocsConfig(absolutePath).status, 'invalid');
});

checkCase('2aw. a known active host uses only its projectDocs manifest', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('active-host');
  const selected = { ...validConfig, domains: ['IFCE'] };
  const other = { ...validConfig, domains: ['GRPH'] };
  const selectedFile = writeHostConfig(root, 'codex', selected);
  writeHostConfig(root, 'claude', other);
  const result = resolveDocsConfig(root, { activeHost: 'codex' });
  assert.strictEqual(result.status, 'host');
  assert.deepStrictEqual(result.sources, [relative(root, selectedFile)]);
  assert.deepStrictEqual(result.config, selected);
});

checkCase('2aw amendment 1. a silent active host returns none and recommends project-docs.json', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('active-host-silent');
  const activeFile = writeHostConfig(root, 'codex', null, '{}');
  writeHostConfig(root, 'claude', validConfig);
  const result = resolveDocsConfig(root, { activeHost: 'codex' });
  assert.strictEqual(result.status, 'none');
  assert.deepStrictEqual(result.sources, [relative(root, activeFile)]);
  const suggestion = (result.warnings || []).find(item => (typeof item === 'string' ? item : item.code) === 'missing-project-docs-config');
  assert.ok(suggestion, 'missing project config warning is required');
  assert.match(typeof suggestion === 'string' ? suggestion : suggestion.message, /\.agents\/harness-everything\/project-docs\.json/);
});

checkCase('2aw amendment 1. host domains string becomes domainLocation with a deprecation warning', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('host-domains-string');
  const sourceFile = writeHostConfig(root, 'claude', { domains: 'records/domain' });
  const result = resolveDocsConfig(root, { activeHost: 'claude' });
  assert.strictEqual(result.status, 'host');
  assert.deepStrictEqual(result.sources, [relative(root, sourceFile)]);
  assert.strictEqual(result.config.domainLocation, 'records/domain');
  assert.ok(!Object.prototype.hasOwnProperty.call(result.config, 'domains'), 'legacy path must not become the domain ID list');
  assert.ok(warningCodes(result).includes('deprecated-domains-string'));
  const zones = resolver.resolveProjectDocs(root);
  assert.strictEqual(zones.paths.domain.path, path.join(root, 'records/domain'));
});

checkCase('2aw amendment 1. invalid host configs are diagnosed and excluded from unknown-host comparison', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('unknown-host-invalid-manifests');
  const validFile = writeHostConfig(root, 'claude', validConfig);
  const invalidSchemaFile = writeHostConfig(root, 'codex', { ...validConfig, domains: ['bad'] });
  const invalidJsonFile = writeHostConfig(root, 'cursor', null, '{ invalid json');
  const result = resolveDocsConfig(root, { activeHost: 'unknown' });
  assert.strictEqual(result.status, 'host');
  assert.deepStrictEqual(result.sources, [relative(root, validFile)]);
  const invalidDiagnostics = (result.diagnostics || []).filter(item => (typeof item === 'string' ? item : item.code) === 'invalid-host-config');
  assert.strictEqual(invalidDiagnostics.length, 2);
  assert.deepStrictEqual(invalidDiagnostics.map(item => item.path).sort(), [relative(root, invalidJsonFile), relative(root, invalidSchemaFile)].sort());
});

checkCase('2aw. unknown host accepts canonically equal configs and records every source', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('unknown-host-equal');
  const first = { governed: validConfig.governed, domains: validConfig.domains, tickets: validConfig.tickets };
  const second = { tickets: 'tracker', domains: ['GRPH', 'IFCE'], governed: [{ role: 'prd', path: 'docs/prd/**' }] };
  const firstFile = writeHostConfig(root, 'claude', first);
  const secondFile = writeHostConfig(root, 'codex', second, ` { "projectDocs" : { "tickets":"tracker", "domains":["GRPH", "IFCE"], "governed":[{"role":"prd", "path":"docs/prd/**"}] } } `);
  const result = resolveDocsConfig(root, { activeHost: 'unknown' });
  assert.strictEqual(result.status, 'host');
  assert.deepStrictEqual(result.sources, [relative(root, firstFile), relative(root, secondFile)]);
  assert.deepStrictEqual(result.config, first);
});

checkCase('2aw. unknown host reports conflicting host configs as ambiguous with null config', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('unknown-host-conflict');
  writeHostConfig(root, 'claude', { ...validConfig, domains: ['GRPH'] });
  writeHostConfig(root, 'codex', { ...validConfig, domains: ['IFCE'] });
  const result = resolveDocsConfig(root, { activeHost: 'unknown' });
  assert.strictEqual(result.status, 'ambiguous');
  assert.strictEqual(result.config, null);
  assert.strictEqual(result.sources.length, 2);
  assert.ok(result.diagnostics.length > 0);
});

checkCase('2aw. no project or host config returns none', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const result = resolveDocsConfig(workspace('none'));
  assert.strictEqual(result.status, 'none');
  assert.deepStrictEqual(result.sources, []);
  assert.strictEqual(result.config, null);
});

checkCase('2aw. reading and validating a generator never executes it', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('generator-security');
  const marker = path.join(tempRoot, 'generator-executed.marker');
  const generatorScript = path.join(root, 'write-generator-marker.js');
  fs.writeFileSync(generatorScript, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`, 'utf8');
  const quoteShellArg = value => process.platform === 'win32'
    ? `"${String(value).replace(/"/g, '""')}"`
    : `'${String(value).replace(/'/g, `'\\''`)}'`;
  const generator = `${quoteShellArg(process.execPath)} ${quoteShellArg(generatorScript)}`;
  execFileSync(process.execPath, [generatorScript]);
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'executed', 'sentinel generator must work when invoked directly');
  fs.unlinkSync(marker);
  const project = { ...validConfig, derived: [{ path: 'docs/index.md', generator }] };
  writeProjectConfig(root, project);
  assert.ok(!fs.existsSync(marker));
  const result = resolveDocsConfig(root);
  assert.strictEqual(typeof resolver.validateDocsConfig, 'function', 'validateDocsConfig export is required');
  const validation = resolver.validateDocsConfig(project);
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(result.status, 'project');
  assert.ok(!fs.existsSync(marker), 'generator marker must remain absent after resolve/validate');
});

checkCase('2aw. repeated project config resolution is deterministic', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('deterministic');
  writeProjectConfig(root, validConfig);
  assert.deepStrictEqual(resolveDocsConfig(root), resolveDocsConfig(root));
});

checkCase('2aw. project file zone fields drive existing zone resolution', () => {
  const root = workspace('project-zones');
  const project = {
    ...validConfig,
    decisionLocation: 'new/decisions',
    domainLocation: 'new/domains',
    architectureLocation: 'new/architecture'
  };
  writeProjectConfig(root, project);
  writeHostConfig(root, 'claude', {
    decisionLocation: 'old/decisions',
    domainLocation: 'old/domains',
    architectureLocation: 'old/architecture'
  });
  const result = resolver.resolveProjectDocs(root);
  assert.strictEqual(result.paths.decision.path, path.join(root, 'new/decisions'));
  assert.strictEqual(result.paths.domain.path, path.join(root, 'new/domains'));
  assert.strictEqual(result.paths.architecture.path, path.join(root, 'new/architecture'));
});

checkCase('2aw. to-spec ships the same standalone resolver implementation', () => {
  const source = fs.readFileSync(toSpecResolverPath, 'utf8');
  assert.strictEqual(source, fs.readFileSync(resolverPath, 'utf8'));
  assert.ok(!source.includes("require('../../multi-agent-workspace"), 'standalone resolver must not defer to a sibling skill');
  assert.strictEqual(typeof toSpecResolver.resolveDocsConfig, 'function');
});

checkCase('2aw fix. caller APIs share active-host selection and keep ambiguous or silent hosts unselected', () => {
  const root = workspace('caller-host-selection');
  writeHostConfig(root, 'claude', { decisionLocation: 'claude-decisions' });
  writeHostConfig(root, 'codex', { decisionLocation: 'codex-decisions' });

  const selected = resolver.readProjectDocs(root, { activeHost: 'codex' });
  assert.strictEqual(selected.status, 'host');
  assert.deepStrictEqual(selected.projectDocs, { decisionLocation: 'codex-decisions' });
  const selectedZones = resolver.resolveProjectDocs(root, { activeHost: 'codex' });
  assert.strictEqual(selectedZones.paths.decision.relativePath, 'codex-decisions');

  const ambiguous = resolver.readProjectDocs(root);
  assert.strictEqual(ambiguous.status, 'ambiguous');
  assert.strictEqual(ambiguous.projectDocs, null);
  assert.ok(ambiguous.diagnostics.some(item => item.code === 'ambiguous-host-project-docs'));
  const ambiguousZones = resolver.resolveProjectDocs(root);
  assert.strictEqual(ambiguousZones.projectDocsStatus, 'ambiguous');
  assert.strictEqual(ambiguousZones.projectDocs, null);
  assert.ok(ambiguousZones.projectDocsDiagnostics.some(item => item.code === 'ambiguous-host-project-docs'));
  assert.ok(!['claude-decisions', 'codex-decisions'].includes(ambiguousZones.paths.decision.relativePath));

  const silent = workspace('caller-host-silent');
  writeHostConfig(silent, 'claude', { decisionLocation: 'claude-decisions' });
  writeHostConfig(silent, 'codex', null, '{}');
  const silentRead = resolver.readProjectDocs(silent, { activeHost: 'codex' });
  assert.strictEqual(silentRead.status, 'none');
  assert.strictEqual(silentRead.projectDocs, null);
  const silentZones = resolver.resolveProjectDocs(silent, { activeHost: 'codex' });
  assert.strictEqual(silentZones.projectDocsStatus, 'none');
  assert.ok(!silentZones.paths.decision.relativePath.includes('claude-decisions'));
});

checkCase('2aw fix. invalid project files never authorize zone paths and surface status at callers', () => {
  const host = { decisionLocation: 'host-decisions', tracker: 'tracker', issueDefinition: 'host-template.md' };
  for (const [name, raw, expectedCode] of [
    ['malformed', '{ malformed json', 'invalid-project-config-json'],
    ['schema-invalid', null, 'invalid-domains']
  ]) {
    const root = workspace(`invalid-project-caller-${name}`);
    writeHostConfig(root, 'claude', host);
    const project = name === 'schema-invalid'
      ? { domains: 'bad', decisionLocation: `invalid-${name}-decisions` }
      : null;
    writeProjectConfig(root, project, raw === null ? undefined : raw);
    const read = resolver.readProjectDocs(root, { activeHost: 'claude' });
    assert.strictEqual(read.status, 'invalid');
    assert.strictEqual(read.projectDocs, null);
    assert.ok(read.diagnostics.some(item => item.code === expectedCode));
    const zones = resolver.resolveProjectDocs(root, { activeHost: 'claude' });
    assert.strictEqual(zones.projectDocsStatus, 'invalid');
    assert.strictEqual(zones.projectDocs, null);
    assert.ok(zones.projectDocsDiagnostics.some(item => item.code === expectedCode));
    assert.notStrictEqual(zones.paths.decision.relativePath, project && project.decisionLocation);
    assert.notStrictEqual(zones.paths.decision.relativePath, 'host-decisions');
  }
});

checkCase('2aw consensus-C5. validateDocsConfig rejects non-canonical globs with field-specific diagnostics', () => {
  for (const [field, buildValue, diagCode] of [
    ['governed', v => [{ path: v, role: 'prd' }], 'invalid-governed-entry'],
    ['legacy', v => [v], 'invalid-legacy-entry'],
    ['derived', v => [{ path: v, generator: 'npm run docs:index' }], 'invalid-derived-entry'],
  ]) {
    for (const value of ['./docs/**', '/docs/**', 'docs\\prd\\**', 'docs/../x', 'docs\\prd']) {
      const root = workspace(`consensus-c5-${field}-${value.length}`);
      const config = {
        docLocation: 'docs/',
        domains: ['GRPH'],
        [field]: buildValue(value),
      };
      const validation = resolver.validateDocsConfig(config);
      assert.strictEqual(validation.valid, false, `${field} value ${JSON.stringify(value)} must be rejected`);
      const diag = validation.diagnostics.find(item => item.code === diagCode);
      assert.ok(diag, `expected diagnostic ${diagCode} for ${field} value ${JSON.stringify(value)}; got ${JSON.stringify(validation.diagnostics)}`);
      assert.strictEqual(diag.severity, 'error');
      assert.match(diag.message, new RegExp(field === 'legacy' ? `legacy\\[[0-9]+\\]` : `${field}\\[[0-9]+\\]\\.path`), 'diagnostic must name the offending field');
      assert.ok(diag.message.includes(JSON.stringify(value)), `diagnostic must quote the offending value; got: ${diag.message}`);
      assert.match(diag.message, /canonical repo-relative|forward slashes|leading "\.\/"|leading "\/"|"\.\." segments/i, `diagnostic must state the rule; got: ${diag.message}`);

      const read = resolver.readProjectDocs(root, { activeHost: 'claude' });
      writeProjectConfig(root, config);
      const afterWrite = resolver.readProjectDocs(root, { activeHost: 'claude' });
      assert.strictEqual(afterWrite.status, 'invalid', `non-canonical ${field} value must leave the selection invalid`);
      assert.strictEqual(afterWrite.projectDocs, null);
    }
  }

  const acceptable = resolver.validateDocsConfig({
    docLocation: 'docs/',
    domains: ['GRPH'],
    governed: [{ path: 'docs/prd/**', role: 'prd' }],
    legacy: ['docs/**'],
    derived: [{ path: 'docs/gen/index.md', generator: 'npm run docs:index' }],
  });
  assert.strictEqual(acceptable.valid, true, `canonical globs must be accepted: ${JSON.stringify(acceptable.diagnostics)}`);
});

checkCase('2aw fix-325. validateDocsConfig rejects globs with empty path segments and accepts canonical globs', () => {
  for (const [field, buildValue, diagCode] of [
    ['governed', v => [{ path: v, role: 'prd' }], 'invalid-governed-entry'],
    ['legacy', v => [v], 'invalid-legacy-entry'],
    ['derived', v => [{ path: v, generator: 'npm run docs:index' }], 'invalid-derived-entry'],
  ]) {
    for (const value of ['docs//prd/**', 'docs/prd//**', 'docs/prd/']) {
      const validation = resolver.validateDocsConfig({
        docLocation: 'docs/',
        domains: ['GRPH'],
        [field]: buildValue(value),
      });
      assert.strictEqual(validation.valid, false, `${field} value ${JSON.stringify(value)} must be rejected`);
      const diag = validation.diagnostics.find(item => item.code === diagCode);
      assert.ok(diag, `expected diagnostic ${diagCode} for ${field} value ${JSON.stringify(value)}; got ${JSON.stringify(validation.diagnostics)}`);
      assert.strictEqual(diag.severity, 'error');
      assert.ok(diag.message.includes('must not contain empty path segments'), `diagnostic must state the empty-segment rule; got: ${diag.message}`);
    }
  }

  const canonical = resolver.validateDocsConfig({
    docLocation: 'docs/',
    domains: ['GRPH'],
    governed: [{ path: 'docs/prd/**', role: 'prd' }],
  });
  assert.strictEqual(canonical.valid, true, `docs/prd/** must stay valid: ${JSON.stringify(canonical.diagnostics)}`);
});

checkCase('2aw fix-327. validateDocsConfig rejects internal dot path segments and accepts canonical globs', () => {
  for (const [field, buildValue, diagCode] of [
    ['governed', v => [{ path: v, role: 'adr' }], 'invalid-governed-entry'],
    ['legacy', v => [v], 'invalid-legacy-entry'],
    ['derived', v => [{ path: v, generator: 'npm run docs:index' }], 'invalid-derived-entry'],
  ]) {
    for (const value of ['docs/./adr/**', 'docs/adr/./**']) {
      const validation = resolver.validateDocsConfig({
        docLocation: 'docs/',
        domains: ['GRPH'],
        [field]: buildValue(value),
      });
      assert.strictEqual(validation.valid, false, `${field} value ${JSON.stringify(value)} must be rejected`);
      const diag = validation.diagnostics.find(item => item.code === diagCode);
      assert.ok(diag, `expected diagnostic ${diagCode} for ${field} value ${JSON.stringify(value)}; got ${JSON.stringify(validation.diagnostics)}`);
      assert.strictEqual(diag.severity, 'error');
      assert.ok(diag.message.includes('must not contain "." path segments'), `diagnostic must state the internal-dot rule; got: ${diag.message}`);
    }
  }

  const canonical = resolver.validateDocsConfig({
    docLocation: 'docs/',
    domains: ['GRPH'],
    governed: [{ path: 'docs/adr/**', role: 'adr' }],
    legacy: ['docs/adr/**'],
    derived: [{ path: 'docs/gen/index.md', generator: 'npm run docs:index' }],
  });
  assert.strictEqual(canonical.valid, true, `docs/adr/** must stay valid: ${JSON.stringify(canonical.diagnostics)}`);
});

checkCase('2aw fix-327. resolver selection rejects a governed internal-dot glob as invalid with no config', () => {
  const root = workspace('invalid-internal-dot-selection');
  const projectFile = writeProjectConfig(root, { ...validConfig, governed: [{ path: 'docs/./adr/**', role: 'adr' }] });
  const result = resolveDocsConfig(root);
  assert.strictEqual(result.status, 'invalid');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.strictEqual(result.config, null);
  assert.ok(diagnosticCodes(result).includes('invalid-governed-entry'), `expected invalid-governed-entry; got ${JSON.stringify(diagnosticCodes(result))}`);
});

checkCase('2aw fix-325. resolver selection rejects a governed empty-segment glob as invalid with no config', () => {
  assert.strictEqual(typeof resolveDocsConfig, 'function', 'resolveDocsConfig export is required');
  const root = workspace('invalid-empty-segment-selection');
  const projectFile = writeProjectConfig(root, { ...validConfig, governed: [{ path: 'docs//prd/**', role: 'prd' }] });
  const result = resolveDocsConfig(root);
  assert.strictEqual(result.status, 'invalid');
  assert.deepStrictEqual(result.sources, [relative(root, projectFile)]);
  assert.strictEqual(result.config, null);
  assert.ok(diagnosticCodes(result).includes('invalid-governed-entry'), `expected invalid-governed-entry; got ${JSON.stringify(diagnosticCodes(result))}`);
});

checkCase('2aw owner-p2. heuristic inference applies only when the selection status is none', () => {
  const project = workspace('owner-p2-inference-project');
  const projectFull = {};
  for (const field of ['docLocation', 'tracker', 'issueDefinition']) {
    if (field === 'docLocation') projectFull[field] = field === 'docLocation' ? 'specs/' : `p-${field}`;
    else projectFull[field] = `p-${field}`;
  }
  writeProjectConfig(project, projectFull);
  fs.mkdirSync(path.join(project, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  const resolved = resolver.detectProjectDocsConventions(project);
  assert.strictEqual(resolved.status, 'project');
  assert.deepStrictEqual(resolved.missing, [], 'fully configured project selection reports no missing fields');
  assert.strictEqual(resolved.tracker, 'p-tracker', 'configured tracker is returned verbatim');

  const partial = workspace('owner-p2-inference-partial');
  writeProjectConfig(partial, { docLocation: 'specs/' });
  fs.mkdirSync(path.join(partial, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  const partialResult = toSpecResolver.detectProjectDocsConventions(partial);
  assert.strictEqual(partialResult.status, 'project');
  assert.strictEqual(partialResult.docLocation, 'specs/', 'configured field kept');
  assert.strictEqual(partialResult.tracker, undefined, 'host conventions must not be inferred for a project selection');
  assert.strictEqual(partialResult.issueDefinition, undefined, 'issue definition must not be inferred for a project selection');
  assert.deepStrictEqual(partialResult.missing, ['tracker', 'issueDefinition'], 'missing-field list is returned');

  const selectedHost = workspace('owner-p2-inference-host');
  writeHostConfig(selectedHost, 'claude', { docLocation: 'specs/' });
  fs.mkdirSync(path.join(selectedHost, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  const hostResult = resolver.detectProjectDocsConventions(selectedHost, { activeHost: 'claude' });
  assert.strictEqual(hostResult.status, 'host');
  assert.strictEqual(hostResult.tracker, undefined, 'host conventions must not be inferred for a selected host');
  assert.deepStrictEqual(hostResult.missing, ['tracker', 'issueDefinition'], 'missing-field list is returned for host selections');

  const empty = workspace('owner-p2-inference-empty');
  writeProjectConfig(empty, {});
  fs.mkdirSync(path.join(empty, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  fs.mkdirSync(path.join(empty, 'docs'), { recursive: true });
  const emptyResult = resolver.detectProjectDocsConventions(empty);
  assert.strictEqual(emptyResult.status, 'project', 'an empty project file stays selected');
  assert.deepStrictEqual(emptyResult.missing, ['docLocation', 'tracker', 'issueDefinition'], 'empty selection stays incomplete');

  const plain = workspace('owner-p2-inference-none');
  fs.mkdirSync(path.join(plain, 'docs'), { recursive: true });
  const noneResult = resolver.detectProjectDocsConventions(plain);
  assert.strictEqual(noneResult.status, 'none');
  assert.strictEqual(noneResult.docLocation, 'docs/', 'status none still permits workspace inference');
});

checkCase('2aw owner-p2. CLI exits 1 listing the actual missing fields for selected/incomplete configs', () => {
  const partial = workspace('owner-p2-cli-partial');
  writeProjectConfig(partial, { docLocation: 'specs/' });
  fs.mkdirSync(path.join(partial, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  const partialRun = runToSpecCheck(partial);
  assert.strictEqual(partialRun.status, 1, `partial selected config must fail: ${partialRun.stdout}`);
  assert.match(partialRun.stdout, /missing fields: tracker, issueDefinition/);
  assert.ok(!partialRun.stdout.includes('GitHub Issues via .github/ISSUE_TEMPLATE/'), 'invented tracker must not appear');

  const empty = workspace('owner-p2-cli-empty');
  writeProjectConfig(empty, {});
  fs.mkdirSync(path.join(empty, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  fs.mkdirSync(path.join(empty, 'docs'), { recursive: true });
  const emptyRun = runToSpecCheck(empty);
  assert.strictEqual(emptyRun.status, 1, `empty {} selection must stay selected and incomplete: ${emptyRun.stdout}`);
  assert.match(emptyRun.stdout, /Selected project projectDocs configuration/i);
  assert.match(emptyRun.stdout, /missing fields: docLocation, tracker, issueDefinition/);

  const ambiguousRoot = workspace('owner-p2-cli-ambiguous');
  writeHostConfig(ambiguousRoot, 'claude', { docLocation: 'a-docs', tracker: 'a-tracker', issueDefinition: 'a-def' });
  writeHostConfig(ambiguousRoot, 'codex', { docLocation: 'b-docs', tracker: 'b-tracker', issueDefinition: 'b-def' });
  const ambiguousRun = runToSpecCheck(ambiguousRoot);
  assert.strictEqual(ambiguousRun.status, 1);
  assert.match(ambiguousRun.stdout + ambiguousRun.stderr, /ambiguous/i);
});

checkCase('2aw owner-p2. init rejects whitespace-only required values consistently with the resolver', () => {
  const projectRoot = workspace('owner-p2-init-whitespace-project');
  const project = { docLocation: 'specs/' };
  const projectFile = writeProjectConfig(projectRoot, project, `${JSON.stringify(project, null, 2)}\n`);
  writeHostConfig(projectRoot, 'claude', { skills: true });
  const hostFile = path.join(projectRoot, '.claude', 'harness-everything', 'manifest.json');
  const projectBefore = fs.readFileSync(projectFile, 'utf8');
  const hostBefore = fs.readFileSync(hostFile, 'utf8');
  const result = runToSpecInit(projectRoot, ['--doc-location', '   ', '--tracker', '   ', '--issue-definition', '   ']);
  assert.strictEqual(result.status, 1, `whitespace-only flags must be rejected: ${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /whitespace-only|must not be empty/i);
  assert.strictEqual(fs.readFileSync(projectFile, 'utf8'), projectBefore, 'whitespace-only init wrote the project file');
  assert.strictEqual(fs.readFileSync(hostFile, 'utf8'), hostBefore, 'whitespace-only init wrote the host manifest');
  const check = runToSpecCheck(projectRoot);
  assert.strictEqual(check.status, 1, 'a whitespace-only init attempt must not make the config complete');
  assert.match(check.stdout, /missing fields: tracker, issueDefinition/);

  const hostRoot = workspace('owner-p2-init-whitespace-host');
  const hostFile2 = writeHostConfig(hostRoot, 'claude', { skills: true });
  const host2Before = fs.readFileSync(hostFile2, 'utf8');
  const result2 = runToSpecInit(hostRoot, ['--doc-location', '   ', '--tracker', '\t\t', '--issue-definition', ' \n ']);
  assert.strictEqual(result2.status, 1, `whitespace-only host init must be rejected: ${result2.stdout}${result2.stderr}`);
  assert.strictEqual(fs.readFileSync(hostFile2, 'utf8'), host2Before, 'whitespace-only host init must write nothing');
});

function runToSpecCheck(root) {
  return spawnSync(process.execPath, [toSpecCheckPath, 'check', '--workspace', root], { encoding: 'utf8' });
}

function runToSpecInit(root, args) {
  return spawnSync(process.execPath, [toSpecCheckPath, 'init', '--workspace', root, ...args], { encoding: 'utf8' });
}

checkCase('2aw owner-p2. init fills only missing fields in an existing valid project file and preserves the rest', () => {
  const root = workspace('owner-p2-init-project-fill');
  const project = {
    docLocation: 'specs/',
    governed: [{ path: 'docs/prd/**', role: 'prd' }],
    domains: ['GRPH'],
    derived: [{ path: 'docs/roadmap/index.md', generator: 'npm run docs:index' }],
    unknownKey: 'preserve-me'
  };
  const projectFile = writeProjectConfig(root, project, `${JSON.stringify(project, null, 2)}\n`);
  const before = fs.readFileSync(projectFile, 'utf8');
  const homesBefore = Object.values(HOSTS).map(h => path.join(root, h, 'harness-everything', 'manifest.json'));
  const result = runToSpecInit(root, ['--doc-location', 'specs/', '--tracker', 'tracker/board', '--issue-definition', 'templates/issue.md']);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const after = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  assert.strictEqual(after.docLocation, 'specs/', 'configured docLocation preserved, not overwritten');
  assert.strictEqual(after.tracker, 'tracker/board', 'missing tracker filled in the project file');
  assert.strictEqual(after.issueDefinition, 'templates/issue.md', 'missing issueDefinition filled in the project file');
  assert.deepStrictEqual(after.governed, project.governed, 'governed preserved');
  assert.deepStrictEqual(after.domains, project.domains, 'domains preserved');
  assert.deepStrictEqual(after.derived, project.derived, 'derived preserved');
  assert.strictEqual(after.unknownKey, project.unknownKey, 'unknown keys preserved');
  assert.ok(!result.stdout.includes('manifest.json'), 'init with a project file must not touch host manifests');
  for (const hostFile of homesBefore) assert.ok(!fs.existsSync(hostFile), 'no host manifest may be created');
  const check = runToSpecCheck(root);
  assert.strictEqual(check.status, 0, `${check.stdout}`);
  assert.match(check.stdout, /docLocation: specs\//);
  assert.match(check.stdout, /tracker: tracker\/board/);
  assert.match(check.stdout, /issueDefinition: templates\/issue\.md/);
  const afterFirstRead = fs.readFileSync(projectFile, 'utf8');
  const result2 = runToSpecInit(root, ['--doc-location', 'specs/', '--tracker', 'tracker/board', '--issue-definition', 'templates/issue.md']);
  assert.strictEqual(result2.status, 0, `${result2.stdout}\n${result2.stderr}`);
  assert.strictEqual(fs.readFileSync(projectFile, 'utf8'), afterFirstRead, 'repeat init stays byte-identical when nothing is missing');
});

checkCase('2aw owner-p2. init rejects conflicting flags for configured project fields with no writes', () => {
  const root = workspace('owner-p2-init-conflict');
  const project = { docLocation: 'specs/', tracker: 'tracker/board' };
  const projectFile = writeProjectConfig(root, project);
  const before = fs.readFileSync(projectFile, 'utf8');
  const result = runToSpecInit(root, ['--doc-location', 'other/', '--tracker', 'different', '--issue-definition', 'templates/issue.md']);
  assert.strictEqual(result.status, 1, `conflicting flags must fail: ${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /doc-location/);
  assert.match(`${result.stdout}\n${result.stderr}`, /specs\//);
  assert.strictEqual(fs.readFileSync(projectFile, 'utf8'), before, 'untouched on conflict');
});

checkCase('2aw owner-p2. init leaves malformed or schema-invalid project files untouched with guidance', () => {
  const malformed = workspace('owner-p2-init-malformed');
  const malformedFile = writeProjectConfig(malformed, null, '{ broken json');
  const malformedBefore = fs.readFileSync(malformedFile, 'utf8');
  const malformedResult = runToSpecInit(malformed, ['--doc-location', 'a/', '--tracker', 'b/', '--issue-definition', 'c']);
  assert.strictEqual(malformedResult.status, 1, `malformed project JSON must fail: ${malformedResult.stdout}${malformedResult.stderr}`);
  assert.match(`${malformedResult.stdout}\n${malformedResult.stderr}`, /project-docs\.json|valid JSON|malformed/i);
  assert.strictEqual(fs.readFileSync(malformedFile, 'utf8'), malformedBefore, 'malformed file untouched');

  const invalid = workspace('owner-p2-init-invalid-schema');
  const invalidFile = writeProjectConfig(invalid, { ...validConfig, domains: 'bad' });
  const invalidBefore = fs.readFileSync(invalidFile, 'utf8');
  const invalidResult = runToSpecInit(invalid, ['--doc-location', 'a/', '--tracker', 'b/', '--issue-definition', 'c']);
  assert.strictEqual(invalidResult.status, 1, `schema-invalid project file must fail: ${invalidResult.stdout}${invalidResult.stderr}`);
  assert.match(`${invalidResult.stdout}\n${invalidResult.stderr}`, /invalid-domains/);
  assert.strictEqual(fs.readFileSync(invalidFile, 'utf8'), invalidBefore, 'invalid schema file untouched');
});

checkCase('2aw owner-p2. host-only init preserves existing host projectDocs keys and fills only missing fields', () => {
  const root = workspace('owner-p2-init-host-preserve');
  const hostFile = writeHostConfig(root, 'claude', {
    governed: [{ path: 'docs/prd/**', role: 'prd' }],
    domains: ['GRPH'],
    docLocation: 'host-docs/',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  const before = JSON.parse(fs.readFileSync(hostFile, 'utf8'));
  const result = runToSpecInit(root, ['--doc-location', 'host-docs/', '--tracker', 'host-tracker', '--issue-definition', 'host-template']);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const after = JSON.parse(fs.readFileSync(hostFile, 'utf8'));
  assert.deepStrictEqual(after.projectDocs.governed, before.projectDocs.governed, 'host governed governance keys preserved');
  assert.deepStrictEqual(after.projectDocs.domains, before.projectDocs.domains, 'host domains preserved');
  assert.strictEqual(after.projectDocs.docLocation, 'host-docs/', 'configured docLocation preserved');
  assert.strictEqual(after.projectDocs.tracker, 'host-tracker', 'missing tracker filled');
  assert.strictEqual(after.projectDocs.issueDefinition, 'host-template', 'missing issueDefinition filled');
  assert.strictEqual(after.projectDocs.updatedAt, before.projectDocs.updatedAt, 'existing updatedAt preserved');
  const conflicting = runToSpecInit(root, ['--doc-location', 'host-docs/', '--tracker', 'different-tracker', '--issue-definition', 'host-template']);
  assert.strictEqual(conflicting.status, 1, `conflicting host flag must fail: ${conflicting.stdout}${conflicting.stderr}`);
  assert.match(`${conflicting.stdout}\n${conflicting.stderr}`, /tracker/);
  assert.strictEqual(JSON.parse(fs.readFileSync(hostFile, 'utf8')).projectDocs.tracker, 'host-tracker', 'no overwrite on conflict');
});

checkCase('2aw fix. to-spec CLI consumes complete project-only fields without inventing host defaults', () => {
  const root = workspace('to-spec-project-only');
  const project = { docLocation: 'specs/', tracker: 'tracker/board', issueDefinition: 'templates/issue.md' };
  writeProjectConfig(root, project);
  const result = runToSpecCheck(root);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /docLocation: specs\//);
  assert.match(result.stdout, /tracker: tracker\/board/);
  assert.match(result.stdout, /issueDefinition: templates\/issue\.md/);
  assert.ok(!result.stdout.includes('local markdown tickets'));
});

checkCase('2aw fix. to-spec CLI refuses conflicting hosts and invalid project override over a complete host', () => {
  const conflict = workspace('to-spec-conflicting-hosts');
  writeHostConfig(conflict, 'claude', { docLocation: 'claude-docs', tracker: 'claude-tracker', issueDefinition: 'claude-template' });
  writeHostConfig(conflict, 'codex', { docLocation: 'codex-docs', tracker: 'codex-tracker', issueDefinition: 'codex-template' });
  const ambiguous = runToSpecCheck(conflict);
  assert.notStrictEqual(ambiguous.status, 0);
  assert.match(`${ambiguous.stdout}\n${ambiguous.stderr}`, /ambiguous/i);
  assert.match(`${ambiguous.stdout}\n${ambiguous.stderr}`, /ambiguous-host-project-docs/);

  const invalid = workspace('to-spec-invalid-project-over-host');
  writeHostConfig(invalid, 'claude', { docLocation: 'host-docs', tracker: 'host-tracker', issueDefinition: 'host-template' });
  writeProjectConfig(invalid, { domains: 'invalid', docLocation: 'invalid-docs', tracker: 'invalid-tracker', issueDefinition: 'invalid-template' });
  const rejected = runToSpecCheck(invalid);
  assert.notStrictEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /invalid/i);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /invalid-domains/);
  assert.ok(!rejected.stdout.includes('host-docs'));
});

helper.finish();
