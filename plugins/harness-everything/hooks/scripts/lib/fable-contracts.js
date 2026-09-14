'use strict';

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function listRunContracts(stateRoot) {
  const runsRoot = path.join(stateRoot, 'fable-runs');
  let runDirs = [];
  try {
    runDirs = fs.readdirSync(runsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(runsRoot, entry.name));
  } catch (_) {
    return [];
  }

  const contracts = [];
  for (const runRoot of runDirs) {
    const contractsDir = path.join(runRoot, 'contracts');
    let files = [];
    try { files = fs.readdirSync(contractsDir).filter(file => file.endsWith('.json')); } catch (_) { continue; }
    for (const file of files) {
      const filePath = path.join(contractsDir, file);
      const contract = readJson(filePath);
      if (!contract || contract.schemaVersion !== 2 || !contract.stageId || !contract.runId || !contract.planId) continue;
      contracts.push({ contract, filePath, runRoot });
    }
  }
  return contracts;
}

function getWorkerId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = payload.worker_id || payload.workerId || payload.subagent_id || payload.subagentId || payload.agent_id || payload.agentId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  for (const container of [payload.tool_input, payload.tool, payload.metadata, payload.context]) {
    if (!container || typeof container !== 'object') continue;
    const nested = getWorkerId(container);
    if (nested) return nested;
  }
  return null;
}

function commandMatches(contract, command) {
  return typeof contract.checkCommand === 'string' && contract.checkCommand.trim() === String(command || '').trim();
}

function chooseCorrelatedContract(matches, payload, sessionId) {
  if (!Array.isArray(matches) || matches.length === 0) return { match: null, ambiguous: false };
  let candidates = matches;
  if (sessionId) {
    candidates = candidates.filter(({ contract }) => !contract.sessionId || contract.sessionId === sessionId);
    if (candidates.length === 0) return { match: null, ambiguous: false };
  }

  const workerId = getWorkerId(payload);
  if (workerId) {
    const hasBoundWorker = candidates.some(({ contract }) => Boolean(contract.workerId));
    if (hasBoundWorker) {
      candidates = candidates.filter(({ contract }) => !contract.workerId || contract.workerId === workerId);
      if (candidates.length === 0) return { match: null, ambiguous: false };
    }
    const workerMatches = candidates.filter(({ contract }) => contract.workerId === workerId);
    if (workerMatches.length === 1) return { match: workerMatches[0], ambiguous: false };
    if (workerMatches.length > 1) return { match: null, ambiguous: true };
  }

  if (candidates.length === 1) return { match: candidates[0], ambiguous: false };
  return { match: null, ambiguous: candidates.length > 1 };
}

function normalizeChangedPath(statusLine) {
  const text = String(statusLine || '');
  const raw = /^..\s/.test(text) ? text.slice(3).trim() : text.trim();
  const renameTarget = raw.includes(' -> ') ? raw.split(' -> ').pop() : raw;
  return renameTarget.replace(/\\/g, '/').replace(/^\.\//, '');
}

function pathWithinScope(filePath, scope) {
  const file = normalizeChangedPath(filePath).replace(/\/+$/g, '');
  const declared = String(scope || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  if (!file || !declared) return false;
  return file === declared || file.startsWith(`${declared}/`);
}

function stagesForChangedPath(filePath, contractEntries) {
  return (contractEntries || []).filter(({ contract }) =>
    Array.isArray(contract.writeSet) && contract.writeSet.some(scope => pathWithinScope(filePath, scope))
  );
}

function getActiveRunContracts(stateRoot, sessionId) {
  return listRunContracts(stateRoot).filter(({ contract }) => {
    if (!['pending', 'planned', 'running'].includes(contract.status)) return false;
    return !sessionId || !contract.sessionId || contract.sessionId === sessionId;
  });
}

module.exports = {
  atomicWriteJson,
  chooseCorrelatedContract,
  commandMatches,
  getActiveRunContracts,
  getWorkerId,
  listRunContracts,
  normalizeChangedPath,
  pathWithinScope,
  readJson,
  stagesForChangedPath,
};
