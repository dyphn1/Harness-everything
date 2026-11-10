#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir } = require('./lib/harness-state');
const { canonical } = require('./lib/workflow-isolation');

const INVENTORY_FILE = 'doc-reconciliation/outline-confirmation/inventory';
const APPROVED_INVENTORY = 'benchmarks/results/live-host/claude-341-outline-dispatch-2026-10-28/inventory/2741bd4514d2cd68f57d93a2b3ce94cbe597ca62d30e26f0ca58e882df5b03c6.md';

function git(root, args, buffer = false) {
  const { execFileSync } = require('child_process');
  return execFileSync('git', ['-C', root, ...args], { encoding: buffer ? null : 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function safeStatePath(sessionDir, relative, allowMissing = false) {
  const sessionRoot = fs.realpathSync.native(sessionDir);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
    throw new Error('invalid-state-destination');
  }
  const destination = path.resolve(sessionRoot, relative);
  const within = path.relative(sessionRoot, destination);
  if (!within || within.startsWith('..' + path.sep) || within === '..' || path.isAbsolute(within)) throw new Error('state-destination-escape');
  let cursor = sessionRoot;
  const parts = relative.split(/[\\/]/);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())
        || (index === parts.length - 1 && !stat.isFile())) throw new Error('state-destination-not-regular');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!allowMissing) throw error;
      break;
    }
  }
  const parent = path.dirname(destination);
  if (fs.existsSync(parent) && fs.realpathSync.native(parent) !== path.resolve(sessionRoot, path.dirname(relative))) {
    throw new Error('state-destination-parent-alias');
  }
  return destination;
}

function writeNewStateFile(sessionDir, relative, bytes) {
  const file = safeStatePath(sessionDir, relative, true);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  safeStatePath(sessionDir, relative, true);
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  if (fs.realpathSync.native(path.dirname(file)) !== path.resolve(fs.realpathSync.native(sessionDir), path.dirname(relative))) {
    throw new Error('state-destination-parent-alias');
  }
  return file;
}

function loadProvider() { return require('./lib/doc-reconciliation-provider'); }

function hostInvocation(sessionId, operation) {
  const root = canonical(getWorkspaceRoot());
  const sessionDir = getSessionDir(root, sessionId);
  const provider = loadProvider();
  const captures = provider.readCaptureView(sessionDir);
  if (captures.tampered) throw new Error('capture-view-tampered');
  const script = fs.realpathSync.native(__filename);
  const matched = captures.records.filter(record => {
    if (!record || record.event !== 'PreToolUse' || record.tool_name !== 'Bash'
      || record.session_id !== sessionId || record.agent_id !== undefined || !record.tool_use_id) return false;
    let cwd;
    try { cwd = canonical(record.cwd); } catch { return false; }
    if (cwd !== root) return false;
    const parsed = provider._internals.safeTokenize(record.command);
    if (!parsed.ok || parsed.tokens.length !== 5 || !['node', 'nodejs'].includes(parsed.tokens[0])) return false;
    let invoked;
    try { invoked = fs.realpathSync.native(path.resolve(cwd, parsed.tokens[1])); } catch { return false; }
    return invoked === script && parsed.tokens[2] === operation
      && parsed.tokens[3] === '--session-id' && parsed.tokens[4] === sessionId;
  });
  if (matched.length !== 1) throw new Error('unique-correlated-pre-invocation-required');
  const pre = matched[0];
  if (captures.records.some(record => record && record.ref !== pre.ref && record.session_id === sessionId
    && record.tool_use_id === pre.tool_use_id && ['PostToolUse', 'PostToolUseFailure'].includes(record.event))) {
    throw new Error('operation-already-completed');
  }
  return { root, sessionDir, provider, captures: captures.records, pre };
}

function loadRow17State(root, sessionDir) {
  const workflow = readJson(path.join(sessionDir, 'workflow-run.json'));
  const task = workflow.docReconciliationTask;
  const baseline = workflow.docReconciliationBaseline;
  if (workflow.strategy !== 'iterative-single' || workflow.state !== 'running' || !Number.isInteger(workflow.revision)
    || !task || task.schema !== 'harness.doc-reconciliation-task-pin.v1'
    || !same(task.requirementIds, ['adr-evid', 'verify-row17']) || task.taskId !== 'task-adr-evid+verify-row17'
    || task.sessionId !== workflow.sessionId || task.workflowId !== workflow.workflowId
    || !baseline || canonical(baseline.root) !== root || task.baselineRoot !== baseline.root
    || task.baselineCommit !== baseline.commit) throw new Error('row17-task-pin-invalid');
  return { workflow, task, baseline };
}

function inventoryBytes(provider) {
  const source = path.resolve(__dirname, '..', '..', APPROVED_INVENTORY);
  if (fs.existsSync(source)) return fs.readFileSync(source);
  const capture = path.join(__dirname, 'lib/doc-reconciliation-outline-capture.sanitized.jsonl');
  for (const line of fs.readFileSync(capture, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const record = JSON.parse(line);
    const candidates = [record.tool_response?.content?.[0]?.text, record.tool_response?.file?.content, record.tool_response?.stdout];
    for (const value of candidates) {
      if (typeof value === 'string' && sha(Buffer.from(value)) === provider._internals.OUTLINE_INVENTORY_PIN.sha256) {
        return Buffer.from(value);
      }
    }
  }
  throw new Error('pinned-inventory-bytes-unavailable');
}

function inventory({ sessionId }) {
  const context = hostInvocation(sessionId, 'inventory');
  const { root, sessionDir, provider } = context;
  const { workflow, task, baseline } = loadRow17State(root, sessionDir);
  const head = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const tree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']).trim();
  if (head !== baseline.commit || tree !== baseline.tree || git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], true).length) {
    throw new Error('inventory-must-run-on-clean-baseline');
  }
  const expectedPin = provider._internals.OUTLINE_INVENTORY_PIN;
  const bytes = inventoryBytes(provider);
  const validated = provider._internals.validateOutlineInventoryPin({ bytes, pin: expectedPin, expectedPin });
  const row = provider._internals.resolveInventoryRow({ parsed: validated.parsed, pin: expectedPin }, '17');
  if (sha(bytes) !== expectedPin.sha256 || validated.state !== 'accepted' || row.state !== 'accepted' || row.row.domain !== 'EVID'
    || expectedPin.rowDomainMappings[0].approvalRef !== 'https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6706805112') {
    throw new Error('pinned-row17-inventory-invalid');
  }
  const inventoryRelative = `${INVENTORY_FILE}/${path.posix.basename(expectedPin.retainedArtifactPath)}`;
  const pinRelative = `${INVENTORY_FILE}/inventory-pin.json`;
  writeNewStateFile(sessionDir, inventoryRelative, bytes);
  writeNewStateFile(sessionDir, pinRelative, jsonBytes(expectedPin));
  return { operation: 'inventory', workflowId: workflow.workflowId, revision: workflow.revision, taskId: task.taskId,
    destinations: [inventoryRelative, pinRelative], sha256: expectedPin.sha256 };
}

function seal({ sessionId }) {
  const context = hostInvocation(sessionId, 'seal');
  const { root, sessionDir, provider, captures } = context;
  const { workflow, task, baseline } = loadRow17State(root, sessionDir);
  const head = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const tree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']).trim();
  if (head === baseline.commit || git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], true).length
    || git(root, ['merge-base', '--is-ancestor', baseline.commit, head]) !== '') throw new Error('seal-requires-clean-b-to-o-outline');
  const expectedPin = provider._internals.OUTLINE_INVENTORY_PIN;
  const inventoryRoot = path.join(sessionDir, INVENTORY_FILE);
  const pinFile = path.join(inventoryRoot, 'inventory-pin.json');
  const pinBytes = fs.readFileSync(pinFile);
  const pin = JSON.parse(pinBytes.toString('utf8'));
  const bytes = fs.readFileSync(path.join(inventoryRoot, path.posix.basename(expectedPin.retainedArtifactPath)));
  const inventory = provider._internals.validateOutlineInventoryPin({ bytes, pin, expectedPin });
  if (inventory.state !== 'accepted' || sha(pinBytes) !== sha(jsonBytes(expectedPin))) throw new Error('pinned-inventory-not-installed');
  const inventoryPath = `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(expectedPin.retainedArtifactPath)}`;
  const reviewEvents = captures.filter(record => record && record.event === 'SubagentStop' && record.agent_type === 'reviewer'
    && record.reviewVerdict === 'approve' && record.reviewSummary);
  const candidates = reviewEvents.filter(review => {
    const targets = Object.keys(review.reviewedArtifactDigests || {}).filter(relative => relative !== inventoryPath);
    return targets.length === 1 && review.reviewedArtifactDigests[inventoryPath] === sha(bytes);
  });
  if (candidates.length !== 1) throw new Error('unique-approved-outline-review-required');
  const review = candidates[0];
  const targetPaths = Object.keys(review.reviewedArtifactDigests).filter(relative => relative !== inventoryPath);
  const target = targetPaths[0];
  const targetBytes = git(root, ['show', `${head}:${target}`], true);
  const citation = provider._internals.parseOutlineCitation(targetBytes, target);
  const row = provider._internals.resolveInventoryRow(inventory, citation.rowId);
  const targetBlob = git(root, ['rev-parse', `${head}:${target}`]).trim();
  if (citation.state !== 'accepted' || citation.rowId !== '17' || citation.domain !== 'EVID'
    || row.state !== 'accepted' || row.row.domain !== 'EVID'
    || review.reviewedArtifactDigests[target] !== sha(targetBytes)) throw new Error('approved-outline-does-not-match-pinned-row17');
  const start = captures.filter(record => record && record.event === 'SubagentStart' && record.agent_id === review.agent_id);
  const launch = captures.filter(record => record && record.event === 'PostToolUse' && ['Task', 'Agent'].includes(record.tool_name)
    && record.agent_id === review.agent_id);
  if (start.length !== 1 || launch.length !== 1 || captures.indexOf(start[0]) >= captures.indexOf(review)
    || captures.indexOf(launch[0]) >= captures.indexOf(review)
    || start[0].outlineIdentity?.state !== 'accepted'
    || start[0].outlineIdentity.identity.outlineCommit !== head || start[0].outlineIdentity.identity.outlineTree !== tree
    || !provider.reviewRecordIndependent(review, captures, { author: sessionId,
      executors: provider.journalExecutors(captures, sessionId) })) throw new Error('outline-review-lifecycle-or-identity-invalid');
  const outlineDigests = { [target]: sha(targetBytes) };
  const attemptId = 'attempt-' + sha(review.ref).slice(0, 16);
  const attemptRelative = `doc-reconciliation/outline-confirmation/${task.taskId}/attempts/${attemptId}`;
  const attemptDir = path.join(sessionDir, attemptRelative);
  const lease = { schema: 'harness.outline-writer-lease.v1', id: 'lease-' + sha(review.ref).slice(0, 16),
    taskId: task.taskId, attemptId, principalId: sessionId, root, exclusive: true, active: true };
  const leaseRelative = `${attemptRelative}/writer-lease.json`;
  const leaseBytes = jsonBytes(lease);
  const leaseDigest = sha(leaseBytes);
  const reviewDigest = provider._internals.captureDigest(review);
  const handoff = {
    schema: 'harness.outline-handoff.v1', handoffId: 'handoff-' + sha(review.ref).slice(0, 16),
    taskId: task.taskId, attemptId, supersedesAttemptId: null, workspaceId: task.workspaceId,
    workflowId: workflow.workflowId, workflowRevision: workflow.revision, sessionId, hostId: 'claude-code',
    baseline: { root: baseline.root, commit: baseline.commit, tree: baseline.tree, configDigest: task.configDigest },
    configDigest: task.configDigest, targetPaths, draftWorktreeRoot: root,
    outline: { commit: head, tree, targetBlobs: { [target]: { blobOid: targetBlob, storedBytesSha256: sha(targetBytes) } } },
    inventory: { ...expectedPin, rowId: '17', domain: 'EVID', targetPaths },
    reviewCaptureRef: review.ref, reviewCaptureDigest: reviewDigest, reviewDigest: review.reviewDigest,
    coordinatorPrincipal: sessionId, writerLeaseId: lease.id, writerLeaseDigest: leaseDigest,
    draftDispatchToken: crypto.randomBytes(24).toString('hex'),
  };
  const validatedReview = provider._internals.validateOutlineReview({ handoff, attemptDir, captures, targetPaths,
    outlineDigests, inventory, sessionId });
  if (validatedReview.state !== 'accepted') throw new Error(validatedReview.reason || 'outline-review-invalid');
  const handoffRelative = `${attemptRelative}/handoff.json`;
  fs.mkdirSync(attemptDir, { recursive: true });
  writeNewStateFile(sessionDir, leaseRelative, leaseBytes);
  writeNewStateFile(sessionDir, handoffRelative, jsonBytes(handoff));
  return { operation: 'seal', workflowId: workflow.workflowId, revision: workflow.revision, taskId: task.taskId,
    attemptId, destinations: [leaseRelative, handoffRelative], handoff };
}

function main(argv) {
  const [operation, flag, sessionId, extra] = argv;
  if (!['inventory', 'seal'].includes(operation) || flag !== '--session-id' || !sessionId || extra !== undefined) {
    throw new Error('Usage: w6-state-operations.js <inventory|seal> --session-id <id>');
  }
  const result = operation === 'inventory' ? inventory({ sessionId }) : seal({ sessionId });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error('[W6 State Operation] ' + error.message); process.exitCode = 2; }
}

module.exports = { main };
