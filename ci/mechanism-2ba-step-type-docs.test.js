const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const registryFile = path.join(ROOT, 'hooks', 'scripts', 'lib', 'step-types.json');
const routerFile = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');
const AUTHORITATIVE_DOC = 'harness-everything/references/router-workflow-plan.md';
const ALLOWED_LIST_DOCS = [
  'docs/routing.md',
  'harness-everything/references/router-workflow-plan.md',
  'harness-everything/references/triage-and-tiers.md',
  'docs/workflows/harness-everything.md',
];
const START = '<!-- step-types:start -->';
const END = '<!-- step-types:end -->';
const FIX_PROMPT = 'Fix this checkout bug and add a regression test.';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-step-type-docs-'));
let failed = 0;

process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));

console.log('\n[2ba] step-type registry documentation and router drift...');

function check(name, ok, detail) {
  if (ok) console.log(`✅ ${name}`);
  else {
    failed++;
    console.log(`❌ ${name}`);
    if (detail) console.log(`   ${detail}`);
  }
}

function checkCase(name, run) {
  try {
    run();
    check(name, true);
  } catch (error) {
    check(name, false, error && error.message ? error.message : String(error));
  }
}

// Independent oracle: renders the registry directly from the JSON file, not through the runtime loader.
function renderRegistry(entries) {
  const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const list = bindings => bindings.map(binding => `\`${binding}\``).join(', ') || 'none';
  return entries.slice().sort(byId).map(entry =>
    `- \`${entry.id}\` — required bindings: ${list(entry.requiredBindings)} — forbidden bindings: ${list(entry.forbiddenBindings)}`,
  );
}

function markerBlocks(text, label) {
  const lines = text.split('\n');
  const blocks = [];
  let openAt = null;
  lines.forEach((line, index) => {
    const marker = line.trim();
    if (marker === START) {
      if (openAt !== null) throw new Error(`${label}: nested step-types:start at line ${index + 1}`);
      openAt = index;
    } else if (marker === END) {
      if (openAt === null) throw new Error(`${label}: step-types:end without start at line ${index + 1}`);
      blocks.push(lines.slice(openAt + 1, index).map(item => item.trim()).filter(Boolean));
      openAt = null;
    }
  });
  if (openAt !== null) throw new Error(`${label}: step-types:start is never closed`);
  return blocks;
}

function routeFixPrompt(runtimeRoot, workspace) {
  const home = path.join(tempRoot, `home-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(home, { recursive: true });
  const payload = { session_id: `2ba-${Math.random().toString(36).slice(2)}`, cwd: workspace, prompt: FIX_PROMPT };
  return spawnSync(process.execPath, [path.join(runtimeRoot, 'harness-everything', 'scripts', 'kernel-router.js')], {
    cwd: workspace,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      HARNESS_STATE_HOME: path.join(tempRoot, 'state'),
      HARNESS_WORKSPACE_ROOT: workspace,
      HOME: home,
      USERPROFILE: home,
    },
  });
}

const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
const registryIds = registry.map(entry => entry.id).sort();
const expectedLines = renderRegistry(registry);

checkCase('2ba. every step-types marker block in the allowed-list docs equals the registry rendering', () => {
  let total = 0;
  for (const doc of ALLOWED_LIST_DOCS) {
    const blocks = markerBlocks(fs.readFileSync(path.join(ROOT, doc), 'utf8'), doc);
    for (const block of blocks) {
      total++;
      if (JSON.stringify(block) !== JSON.stringify(expectedLines)) {
        throw new Error(`${doc} marker block drifted from the registry:\n${block.join('\n')}\nexpected:\n${expectedLines.join('\n')}`);
      }
    }
  }
  if (total === 0) throw new Error('no step-types marker block found in any allowed-list doc');
  const authoritative = markerBlocks(fs.readFileSync(path.join(ROOT, AUTHORITATIVE_DOC), 'utf8'), AUTHORITATIVE_DOC);
  if (authoritative.length !== 1) throw new Error(`${AUTHORITATIVE_DOC} must carry exactly one step-types marker block; found ${authoritative.length}`);
});

checkCase('2ba. router lists exactly the registry step-type ids', () => {
  const routed = routeFixPrompt(ROOT, ROOT);
  if (routed.status !== 0) throw new Error(`router exited ${routed.status}: ${routed.stderr}`);
  const match = routed.stdout.match(/Record ordered step types \(([^)]*)\) and their bindings/);
  if (!match) throw new Error('router did not print the ordered step-type list');
  const listed = match[1].split(',').map(item => item.trim());
  if (JSON.stringify(listed) !== JSON.stringify(registryIds)) {
    throw new Error(`router listed [${listed.join(', ')}]; registry ids are [${registryIds.join(', ')}]`);
  }
});

checkCase('2ba. router example plan does not steer step authoring toward behavior-change', () => {
  const routed = routeFixPrompt(ROOT, ROOT);
  const recordPlan = routed.stdout.split('\n').find(line => line.includes('Record plan:')) || '';
  if (!recordPlan) throw new Error('router did not print a Record plan example');
  if (recordPlan.includes('behavior-change')) throw new Error(`example still hard-codes behavior-change: ${recordPlan}`);
});

checkCase('2ba. router prints the explicit-choice guidance line exactly once in fresh tier2 output', () => {
  const guidance = '- Replace <step-type-id> with a registered type you choose explicitly; mixed docs+code work uses separate doc-change and behavior-change steps; keep the verification step.';
  const routed = routeFixPrompt(ROOT, ROOT);
  if (routed.status !== 0) throw new Error(`router exited ${routed.status}: ${routed.stderr}`);
  const matches = routed.stdout.split('\n').filter(line => line.trim() === guidance);
  if (matches.length !== 1) throw new Error(`expected the guidance line exactly once; found ${matches.length}`);
});

checkCase('2ba. router record-plan guidance keeps the space after "node" in fresh tier2 output', () => {
  const routed = routeFixPrompt(ROOT, ROOT);
  if (routed.status !== 0) throw new Error(`router exited ${routed.status}: ${routed.stderr}`);
  if (!routed.stdout.includes('   - Record plan: node "')) {
    throw new Error(`router record-plan line lacks "Record plan: node"; got: ${routed.stdout.split('\n').find(line => line.includes('Record plan')) || '(none)'}`);
  }
});

checkCase('2ba. router never crashes or prints a stale step-type list when the registry is missing', () => {
  const copy = path.join(tempRoot, 'runtime-without-registry');
  fs.cpSync(ROOT, copy, {
    recursive: true,
    filter: source => !/[\\/](node_modules|\.git|benchmarks|plugins)([\\/]|$)/.test(source),
  });
  fs.rmSync(path.join(copy, 'hooks', 'scripts', 'lib', 'step-types.json'));
  const routed = routeFixPrompt(copy, copy);
  if (routed.status !== 0) throw new Error(`router exited ${routed.status} without the registry: ${routed.stderr}`);
  if (/Record ordered step types \(/.test(routed.stdout)) throw new Error('router printed a step-type list without a registry');
  if (!routed.stderr.includes('cannot load step-type registry')) {
    throw new Error(`router did not surface the missing registry visibly; stderr: ${routed.stderr}`);
  }
});

checkCase('2ba. router-workflow-plan documents old-runtime rejection of persisted doc-change plans', () => {
  const text = fs.readFileSync(path.join(ROOT, AUTHORITATIVE_DOC), 'utf8');
  for (const required of ['doc-change', 'declared-only', 'planning:steps-invalid']) {
    if (!text.includes(required)) throw new Error(`${AUTHORITATIVE_DOC} must mention ${required}`);
  }
});

process.exitCode = failed ? 1 : 0;
