#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getSessionDir, readCurrentSession } = require('./lib/harness-state');

const ALLOWED_ESCAPE_REASONS = new Set([
  'workflow-uncovered-scope',
  'host-capability-unavailable',
]);

function parseArgs(argv) {
  const args = { command: argv[0] || null };
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--reason-code') args.reasonCode = argv[++i];
    else if (token === '--scope') args.scope = argv[++i];
    else if (token === '--evidence') args.evidence = argv[++i];
    else if (token === '--session-id') args.sessionId = argv[++i];
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return 'Usage: node workflow-disposition.js escape --reason-code <workflow-uncovered-scope|host-capability-unavailable> --scope <uncovered-scope> --evidence <evidence> [--session-id <id>]';
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.command !== 'escape') throw new Error(usage());
    if (!ALLOWED_ESCAPE_REASONS.has(args.reasonCode)) {
      throw new Error('escape reason is not permitted; generic simple/routine/already-clear reasons are intentionally rejected');
    }
    if (!args.scope || !String(args.scope).trim()) throw new Error('--scope is required');
    if (!args.evidence || !String(args.evidence).trim()) throw new Error('--evidence is required');

    const root = getWorkspaceRoot();
    const sessionId = args.sessionId || readCurrentSession(root);
    if (!sessionId) throw new Error('no active Harness session is known; pass --session-id explicitly');
    const stateFile = path.join(getSessionDir(root, sessionId), 'workflow-run.json');
    if (!fs.existsSync(stateFile)) throw new Error('no active workflow contract exists for this session');
    const workflow = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (workflow.state !== 'active') throw new Error(`workflow is not active: ${workflow.state}`);

    workflow.state = 'escaped';
    workflow.disposition = {
      status: 'escaped',
      reasonCode: args.reasonCode,
      uncoveredScope: String(args.scope).trim(),
      evidence: String(args.evidence).trim(),
      recordedAt: new Date().toISOString(),
    };
    fs.writeFileSync(stateFile, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      status: workflow.state,
      strategy: workflow.strategy,
      disposition: workflow.disposition,
    })}\n`);
  } catch (err) {
    console.error(`[Workflow Disposition] ${err.message}`);
    process.exit(2);
  }
}

main();
