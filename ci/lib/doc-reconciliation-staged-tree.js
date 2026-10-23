'use strict';

// #325 F4-T2 test helper: stages a scratch copy of one leg's real entries (hooks, harness scripts and the retained
// live-host capture), so a test chooses the qualification export itself. A staged tree never carries the repository's
// export, and nothing here writes into the repository. The real entries run from the copy, with copied siblings, so
// the provider walks up to the copied retained directory exactly as it would in the checkout.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const LIVE_REL = path.join('benchmarks', 'results', 'live-host', 'claude-325-3b-s2b');
const EXPORT_FILE = 'doc-reconciliation-qualification.json';
const CAPTURE_FILE = 'capture.sanitized.jsonl';
// The export names its sanitized capture as a sibling in the same lib directory, so source and packaged copies resolve it
// the same way (the provider reads it from there).
const SIBLING_CAPTURE = 'doc-reconciliation-capture.sanitized.jsonl';
// Facts observed in the retained Run 2b capture (see benchmarks/results/live-host/claude-325-3b-s2b/README.md). A valid
// export states exactly these; the runtime checks them against the sibling file.
const OBSERVED_PAYLOAD_KINDS = {
  PostToolUse: ['agent_id', 'interrupted', 'tool_use_id'],
  PreToolUse: ['agent_id', 'tool_use_id'],
  SubagentStart: ['agent_id'],
  SubagentStop: ['agent_id'],
};
const OBSERVED_CORRELATION = { preToPostByToolUseId: true, interruptedExplicit: true, subagentStartStopSameAgent: true, agentResultAliasCorrelated: true };

// Top-level entries the source leg never reads: VCS and dependency trees, the worktrees, the test corpus, the evidence
// directories and the packaging copies. The live-host capture is copied separately, below.
const SOURCE_EXCLUDE = new Set(['.git', 'node_modules', '.worktrees', 'ci', 'benchmarks', 'behavioral-evals', 'evals', 'docs', 'plugins', 'submission', 'opencode-plugin']);

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Stages one leg. Returns the replay distribution (explicit entry paths inside the copy) and the helpers a test needs.
// The live-host directory is copied to the top of the tree, which is where the provider's upward walk finds it.
function stage(leg) {
  if (leg !== 'source' && leg !== 'packaged') throw new Error(`unknown leg ${leg}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `f4-staged-${leg}-`));
  let base;
  if (leg === 'source') {
    // The source package: the root carries the hooks, the harness scripts, the shared libraries and the root skill
    // folders that bindings resolve. Only data that the entries never read is left out.
    for (const entry of fs.readdirSync(ROOT)) {
      if (SOURCE_EXCLUDE.has(entry)) continue;
      fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
    }
    base = root;
  } else {
    fs.cpSync(path.join(ROOT, 'plugins', 'harness-everything'), path.join(root, 'plugin'), { recursive: true });
    base = path.join(root, 'plugin');
  }
  fs.cpSync(path.join(ROOT, LIVE_REL), path.join(root, LIVE_REL), { recursive: true });
  const libDir = path.join(base, 'hooks', 'scripts', 'lib');
  // The copied tree may carry a checkout's own export: a staged tree starts without one.
  fs.rmSync(path.join(libDir, EXPORT_FILE), { force: true });
  fs.rmSync(path.join(libDir, SIBLING_CAPTURE), { force: true });
  fs.copyFileSync(path.join(root, LIVE_REL, CAPTURE_FILE), path.join(libDir, SIBLING_CAPTURE));
  const skillScripts = leg === 'source' ? path.join(base, 'harness-everything', 'scripts') : path.join(base, 'skills', 'harness-everything', 'scripts');
  const dist = {
    controller: path.join(base, 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(base, 'hooks', 'scripts', 'workflow-stop-gate.js'),
    kernel: path.join(skillScripts, 'kernel-router.js'),
    genericStopGate: path.join(base, 'hooks', 'scripts', 'stop-gate.js'),
    stateHook: path.join(base, 'hooks', 'scripts', 'state-persist.js'),
    docCheck: path.join(skillScripts, 'doc-check.js'),
  };
  return {
    root,
    leg,
    dist,
    libDir,
    exportFile: path.join(libDir, EXPORT_FILE),
    captureFile: path.join(libDir, SIBLING_CAPTURE),
    retainedCaptureFile: path.join(root, LIVE_REL, CAPTURE_FILE),
    // The export that binds the staged capture bytes and records the two populated fields.
    // The valid export for this capture. `overrides` lets a test change one field, to show the runtime refuses it.
    validExport(overrides = {}) {
      return {
        schema: 'harness.doc-reconciliation.qualification.v1',
        host: 'claude-code',
        hostVersion: '2.1.308',
        captureRecordVersion: 'claude-capture-record/1',
        payloadKinds: OBSERVED_PAYLOAD_KINDS,
        correlation: OBSERVED_CORRELATION,
        sanitizedCapture: { file: SIBLING_CAPTURE, sha256: sha256File(path.join(libDir, SIBLING_CAPTURE)) },
        ...overrides,
      };
    },
    writeExport(content) {
      fs.writeFileSync(this.exportFile, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', 'utf8');
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

module.exports = { stage, EXPORT_FILE, SIBLING_CAPTURE, LIVE_REL, CAPTURE_FILE };
