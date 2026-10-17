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

function runToSpecCheck(root) {
  return spawnSync(process.execPath, [toSpecCheckPath, 'check', '--workspace', root], { encoding: 'utf8' });
}

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
