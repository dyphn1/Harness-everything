const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const workspaceModule = path.join(root, 'scripts', 'lib', 'workspace.js');
const stateModule = path.join(root, 'hooks', 'scripts', 'lib', 'harness-state.js');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2u-issue-42-'));
const fakeHome = path.join(fixture, 'home');
const stateHome = path.join(fakeHome, '.agents', 'harness-everything');
const noGitA = path.join(fixture, 'scratch-a');
const noGitB = path.join(fixture, 'scratch-b');
const failures = [];

for (const dir of [fakeHome, stateHome, noGitA, noGitB]) fs.mkdirSync(dir, { recursive: true });

const baseEnv = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, HARNESS_STATE_HOME: stateHome };
for (const name of ['HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR', 'FABLE_WORKSPACE_ROOT']) {
  delete baseEnv[name];
}

function check(name, condition, detail) {
  if (condition) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}`);
    if (detail) console.error(`     ${detail}`);
    failures.push(name);
  }
}

function run(cwd, args, env = baseEnv) {
  return spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
}

function requirePath(file) {
  return JSON.stringify(file.replace(/\\/g, '/'));
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    result.push(target);
    if (entry.isDirectory()) result.push(...filesUnder(target));
  }
  return result;
}

function parseJSON(result) {
  try { return JSON.parse(result.stdout); } catch { return null; }
}

console.log('\n[2u] Issue #42 adversarial regressions...');

const identityScript = `
  const { getWorkspaceRoot, getWorkspaceKey } = require(${requirePath(workspaceModule)});
  console.log(JSON.stringify({ root: getWorkspaceRoot(), key: getWorkspaceKey() }));
`;
const identityA = parseJSON(run(noGitA, ['-e', identityScript]));
const identityB = parseJSON(run(noGitB, ['-e', identityScript]));
check(
  '2u. no-context non-git calls do not adopt either invocation directory',
  identityA && identityB && identityA.root === null && identityB.root === null,
  JSON.stringify({ identityA, identityB })
);
check(
  '2u. no-context non-git calls use one stable unbound workspace key',
  identityA && identityB && identityA.key === identityB.key,
  JSON.stringify({ identityA, identityB })
);

const scaffold = path.join(root, 'multi-agent-workspace', 'scripts', 'scaffold.js');
const scaffoldRun = run(noGitA, [scaffold]);
check(
  '2u. scaffold refuses to infer a workspace outside git instead of writing locally',
  scaffoldRun.status !== 0 && !fs.existsSync(path.join(noGitA, '.harness')),
  `exit=${scaffoldRun.status} output=${scaffoldRun.stderr || scaffoldRun.stdout}`
);

const evaluate = path.join(root, 'eval-harness', 'scripts', 'evaluate.js');
const evaluateRun = run(noGitA, [evaluate, '10', '10', '10', '10', 'issue 42']);
check(
  '2u. evaluate refuses to write a report without a resolved workspace',
  evaluateRun.status !== 0 && !fs.existsSync(path.join(noGitA, 'evals')),
  `exit=${evaluateRun.status} output=${evaluateRun.stderr || evaluateRun.stdout}`
);

const persistMemory = path.join(root, 'self-evolve', 'scripts', 'persist-memory.js');
const persistRun = run(noGitA, [persistMemory, 'Always verify workspace-root resolution with regression tests before writing state.']);
check(
  '2u. persist-memory refuses to write project memory without a resolved workspace',
  persistRun.status !== 0 && !fs.existsSync(path.join(noGitA, 'memories')),
  `exit=${persistRun.status} output=${persistRun.stderr || persistRun.stdout}`
);

const copiedResolverFiles = [
  'eval-harness/scripts/evaluate.js',
  'multi-agent-workspace/scripts/scaffold.js',
  'self-evolve/scripts/persist-memory.js',
  'self-evolve/scripts/register-dynamic-skill.js',
  'security-review/scripts/audit-secrets.js',
  'to-spec/scripts/check-project-docs.js'
];
for (const relative of copiedResolverFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  check(
    `2u. ${relative} has no bare process.cwd fallback`,
    !/return\s+process\.cwd\(\);/.test(source),
    'found a bare cwd return'
  );
}

const findSkill = path.join(root, 'find-skills', 'scripts', 'use-skill.js');
const cacheSource = `owner/repo@issue42-cache-${process.pid}-${Date.now()}`;
const cacheHash = crypto.createHash('sha1').update(cacheSource).digest('hex');
const expectedCache = path.join(stateHome, 'cache', 'find-skills', `${cacheHash}.md`);
fs.mkdirSync(path.dirname(expectedCache), { recursive: true });
fs.writeFileSync(expectedCache, 'CACHED\n', 'utf8');
const fakeBin = path.join(fixture, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });
const fakeNpx = path.join(fakeBin, process.platform === 'win32' ? 'npx.cmd' : 'npx');
fs.writeFileSync(
  fakeNpx,
  process.platform === 'win32' ? '@echo off\r\necho FETCHED\r\n' : '#!/bin/sh\necho FETCHED\n',
  'utf8'
);
if (process.platform !== 'win32') fs.chmodSync(fakeNpx, 0o755);
const cacheRun = run(noGitA, [findSkill, cacheSource, '--max-age', '6'], {
  ...baseEnv,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`
});
const legacyCache = path.join(os.tmpdir(), 'harness-find-skills-cache', `${cacheHash}.md`);
check(
  '2u. find-skills reads its cache from HARNESS_STATE_HOME',
  cacheRun.status === 0 && cacheRun.stdout.includes('CACHED') && fs.existsSync(expectedCache),
  `exit=${cacheRun.status} stdout=${cacheRun.stdout} stderr=${cacheRun.stderr}`
);
check(
  '2u. find-skills does not create the legacy OS-temp cache',
  !fs.existsSync(legacyCache),
  legacyCache
);
if (fs.existsSync(legacyCache)) fs.unlinkSync(legacyCache);

const fable = path.join(root, 'fable-mode', 'scripts', 'model-selector.js');
const fableArgs = [
  fable, '--requested', 'haiku', '--available', 'haiku',
  '--available-agents', 'fable-worker-haiku', '--stage-brief', 'identity',
  '--pass-condition', 'audit', '--verification-command', 'node test',
  '--verifier-result', 'pass'
];
const fableA = run(noGitA, fableArgs);
const fableB = run(noGitB, fableArgs);
const auditFiles = filesUnder(stateHome).filter(file => path.basename(file) === 'audit.jsonl');
check(
  '2u. standalone fable calls from unrelated non-git dirs share one unbound audit stream',
  fableA.status === 0 && fableB.status === 0 &&
    filesUnder(noGitA).length === 0 && filesUnder(noGitB).length === 0 &&
    auditFiles.length === 1 && fs.readFileSync(auditFiles[0], 'utf8').trim().split(/\r?\n/).length === 2,
  `runs=${fableA.status},${fableB.status} audits=${JSON.stringify(auditFiles)}`
);

const gitWorkspace = path.join(fixture, 'git-workspace');
fs.mkdirSync(gitWorkspace, { recursive: true });
const gitInit = spawnSync('git', ['init', '--quiet'], { cwd: gitWorkspace, encoding: 'utf8' });
check('2u. git fixture initialized for migration checks', gitInit.status === 0, gitInit.stderr);

const legacyMultiAgent = path.join(gitWorkspace, '.harness', 'multi-agent');
fs.mkdirSync(path.join(legacyMultiAgent, 'state'), { recursive: true });
fs.writeFileSync(path.join(legacyMultiAgent, 'state', 'legacy.json'), 'legacy', 'utf8');
const migrateScript = `
  const { getStateRoot } = require(${requirePath(stateModule)});
  console.log(getStateRoot(${JSON.stringify(gitWorkspace)}));
`;
const migrationRun = run(noGitA, ['-e', migrateScript]);
const newStateRoot = migrationRun.stdout.trim();
check(
  '2u. legacy .harness/multi-agent state moves under the global workspace state',
  migrationRun.status === 0 && !fs.existsSync(legacyMultiAgent) &&
    fs.existsSync(path.join(newStateRoot, 'multi-agent', 'state', 'legacy.json')),
  `exit=${migrationRun.status} stdout=${migrationRun.stdout} stderr=${migrationRun.stderr}`
);

if (process.platform === 'win32') {
  const caseScript = `
    const { getWorkspaceKey } = require(${requirePath(workspaceModule)});
    const root = ${JSON.stringify(gitWorkspace)};
    console.log(JSON.stringify({ original: getWorkspaceKey(root), variant: getWorkspaceKey(root.toUpperCase()) }));
  `;
  const caseResult = parseJSON(run(noGitA, ['-e', caseScript]));
  check(
    '2u. Windows case variants resolve to one workspace key',
    caseResult && caseResult.original === caseResult.variant,
    JSON.stringify(caseResult)
  );
}

const opencodeHome = path.join(fixture, 'opencode-home');
const opencodeStateHome = path.join(fixture, 'opencode-state');
const opencodeWorkspace = path.join(fixture, 'opencode-workspace');
for (const dir of [opencodeHome, opencodeStateHome, opencodeWorkspace]) fs.mkdirSync(dir, { recursive: true });
const opencodeReal = fs.realpathSync(path.resolve(opencodeWorkspace));
const opencodeSlug = path.basename(opencodeReal).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
const opencodeHash = crypto.createHash('sha1').update(process.platform === 'win32' ? opencodeReal.toLowerCase() : opencodeReal).digest('hex').slice(0, 12);
const opencodeStateDir = path.join(opencodeStateHome, 'workspaces', `${opencodeSlug}-${opencodeHash}`);
const opencodeLegacy = path.join(opencodeHome, '.harness-state');
fs.mkdirSync(opencodeStateDir, { recursive: true });
fs.mkdirSync(opencodeLegacy, { recursive: true });
fs.writeFileSync(path.join(opencodeLegacy, 'edit-state.json'), '{"legacy":true}', 'utf8');
const opencodeScript = `
  import { existsSync } from 'node:fs';
  const { HarnessEnforcement } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'opencode-plugin', 'index.mjs')).href)});
  await HarnessEnforcement({ client: {}, directory: ${JSON.stringify(opencodeWorkspace)} });
  console.log(JSON.stringify({ legacy: existsSync(${JSON.stringify(opencodeLegacy)}), target: existsSync(${JSON.stringify(path.join(opencodeStateDir, 'edit-state.json'))}) }));
`;
const opencodeRun = run(noGitA, ['--input-type=module', '-e', opencodeScript], {
  ...baseEnv,
  HOME: opencodeHome,
  USERPROFILE: opencodeHome,
  HARNESS_STATE_HOME: opencodeStateHome
});
const opencodeResult = parseJSON(opencodeRun);
check(
  '2u. opencode merges flat legacy state even when the target directory exists',
  opencodeRun.status === 0 && opencodeResult && opencodeResult.legacy === false && opencodeResult.target === true,
  `exit=${opencodeRun.status} stdout=${opencodeRun.stdout} stderr=${opencodeRun.stderr}`
);

try { fs.rmSync(fixture, { recursive: true, force: true }); } catch (err) { /* best effort test cleanup */ }

if (failures.length > 0) {
  console.error(`\n${failures.length} issue-42 regression check(s) failed.`);
  process.exit(1);
}
console.log('All issue-42 regression checks passed.');
