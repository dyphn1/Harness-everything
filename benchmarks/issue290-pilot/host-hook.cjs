'use strict';

// Experiment-only host adapter. Calls the unchanged canonical router through
// UserPromptSubmit; all other event handling is read-only observation.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(raw);
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.pilot.json'), 'utf8'));
  const event = payload.hook_event_name || process.argv[2];
  const record = {
    event, session: payload.session_id, tool: payload.tool_name,
    input: payload.tool_input, time: new Date().toISOString(),
  };
  fs.appendFileSync(config.trace, JSON.stringify(record) + '\n');
  if (event !== 'UserPromptSubmit') return;
  const result = spawnSync(process.execPath, [path.join(config.source, 'harness-everything/scripts/kernel-router.js')], {
    input: raw, encoding: 'utf8', cwd: process.cwd(), env: process.env,
  });
  fs.appendFileSync(config.routerTrace, result.stdout || '');
  if (result.stderr) fs.appendFileSync(config.routerTrace, result.stderr);
  let context = result.stdout || '';
  context += '\nEXPERIMENT REFERENCE TIMING: All files in .harness are identical in both arms. Preserve selected workflow, checks, permissions, bindings, status and labels.\n';
  if (config.arm === 'A') {
    context += 'For this controlled timing ablation only, read every listed reference now, including later-step material. Apply a contract only when its step is applicable. This experiment instruction overrides only the active-step read-timing restriction.\n';
    context += config.documents.map(p => path.join(process.cwd(), '.harness', p)).join('\n');
  } else {
    context += 'Read only the references needed by the current active step; defer later-step documents until applicable. Resolve the required bindings before passing their steps.\n';
  }
  console.log(JSON.stringify({hookSpecificOutput: {hookEventName: 'UserPromptSubmit', additionalContext: context}}));
});
