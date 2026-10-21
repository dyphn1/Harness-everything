'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { atomicWriteJson } = require('./fable-contracts');

const enabled = () => process.env.HARNESS_DOC_RECONCILIATION_PILOT === '1';

function git(root, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try {
    return execFileSync('git', ['-C', root, ...args], {
      env, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw new Error('baseline-unavailable', { cause });
  }
}

function runtimeModule(name) {
  for (const relative of ['../../../harness-everything/scripts', '../../../skills/harness-everything/scripts']) {
    const file = path.resolve(__dirname, relative, name + '.js');
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error('document runtime unavailable');
}

// Only capture at plan/start. A later credit assessment must never advance the baseline to HEAD.
function captureBaseline(context) {
  if (!enabled() || context.workflow.docReconciliationBaseline) return;
  try {
    const root = git(context.root, ['rev-parse', '--show-toplevel']).trim();
    const commit = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    context.workflow.docReconciliationBaseline = { root, commit };
  } catch {
    // Absence is intentionally retained; credit assessment will fail closed.
  }
}

function collect(context) {
  const baseline = context.workflow.docReconciliationBaseline;
  if (!baseline) throw new Error('baseline-unavailable');
  const root = git(context.root, ['rev-parse', '--show-toplevel']).trim();
  if (root !== baseline.root || !/^[0-9a-f]{40,64}$/.test(baseline.commit)) throw new Error('baseline-unavailable');
  const { resolveDocsConfig } = runtimeModule('project-docs-resolver');
  const resolved = resolveDocsConfig(root);
  if (!['project', 'host'].includes(resolved.status)) throw new Error('config-unavailable');
  const { readGitBaseInventory, scanWorkspaceFiles } = runtimeModule('doc-lifecycle');
  // Broaden artifact discovery only, never the config passed to obligation derivation. Code/REQ-test
  // facts require baseline bytes outside governed document globs as well.
  const base = readGitBaseInventory(root, baseline.commit, { governed: [{ path: '**/*', role: 'reference' }] });
  const basePaths = git(root, ['ls-tree', '-r', '--name-only', '-z', baseline.commit]).split('\0').filter(Boolean);
  if (!base.available) throw new Error('baseline-unavailable');
  if (base.files.length !== basePaths.length) throw new Error('scope-unavailable');
  const paths = [...new Set(git(root, ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  const existing = paths.filter(relative => {
    try {
      if (!fs.lstatSync(path.join(root, relative)).isFile()) throw new Error('scope-unavailable');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false; // tracked deletion
      throw error;
    }
  });
  const candidate = scanWorkspaceFiles(root, { paths: existing });
  if (candidate.length !== existing.length) throw new Error('scope-unavailable');
  const snapshots = files => ({ files: Object.fromEntries(files.map(item => [item.path, item.bytes.toString('utf8')])) });
  const { deriveDocFacts, deriveDocObligations } = runtimeModule('doc-obligations');
  const { facts } = deriveDocFacts({ base: snapshots(base.files), candidate: snapshots(candidate), config: resolved.config, inventory: { complete: true } });
  return deriveDocObligations(facts).filter(item => item.strength === 'MUST' && item.applicability !== 'N/A');
}

// Assessment is deliberately negative-credit only in S1. Unsupported topologies never enter
// generic step reconciliation, and failures (including report persistence) never escape to Stop.
function assess(context, set) {
  if (!enabled()) return { withhold: false };
  const report = {
    schemaVersion: 1, reportOrigin: 'runtime', pilotStatus: 'unavailable', pilotCredit: false,
    identity: null, expectedMustIds: [], results: [], unsatisfied: [], diagnostics: [],
  };
  const supported = set?.stepBindingsEnabled === true && !String(context.workflow.strategy || '').startsWith('fable-');
  let withhold = false;
  if (!supported) report.diagnostics.push('unsupported-workflow');
  else {
    try {
      const musts = collect(context);
      withhold = musts.length > 0;
      report.pilotStatus = 'unresolved';
      report.expectedMustIds = musts.map(item => item.id);
      report.unsatisfied = musts.map(item => ({
        obligationId: item.id, state: item.applicability === 'unknown' ? 'unknown' : 'pending',
        reasonCode: item.applicability === 'unknown' ? 'unknown-applicability' : 'producer-unavailable',
      }));
      if (!withhold) report.diagnostics.push('trusted-non-document-scope');
    } catch (error) {
      withhold = true;
      const reason = ['baseline-unavailable', 'config-unavailable', 'scope-unavailable'].includes(error.message)
        ? error.message : 'collector-unavailable';
      report.diagnostics.push(reason);
      report.unsatisfied.push({ obligationId: 'doc-change:scope', state: 'unavailable', reasonCode: reason });
    }
  }
  try { atomicWriteJson(path.join(context.sessionDir, 'doc-reconciliation-pilot.json'), report); }
  catch {
    if (supported) withhold = true;
    console.error('[Workflow Reminder] Document pilot report unavailable; no document verification credit.');
  }
  return { withhold, report };
}

module.exports = { enabled, captureBaseline, assess };
