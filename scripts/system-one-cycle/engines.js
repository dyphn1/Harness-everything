'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_OUTPUT = 2 * 1024 * 1024;

function capture(command, args, prompt, { cwd = process.cwd(), env = process.env, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const child = spawn(command, args, { cwd, env, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('engine-timeout')); }, 600000);
    child.on('error', () => finish(new Error('engine-unavailable')));
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT) {
        child.kill(); finish(new Error('engine-output-limit'));
      }
    });
    child.on('close', code => code === 0 ? finish(null, output) : finish(new Error('engine-failed')));
    child.stdin.end(prompt);
  });
}

async function runStructured(engine, prompt, schema, { model } = {}) {
  if (engine === 'luna') {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-engine-'));
    const schemaFile = path.join(temp, 'schema.json');
    const outputFile = path.join(temp, 'reply.json');
    fs.writeFileSync(schemaFile, JSON.stringify(typeof schema === 'string' ? JSON.parse(schema) : schema));
    try {
      await capture('codex', [
        'exec', '--model', model || 'gpt-6-luna', '-c', 'model_reasoning_effort=high', '--sandbox', 'read-only',
        '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--output-schema', schemaFile,
        '-o', outputFile, '-C', temp, '-',
      ], prompt, { cwd: temp, shell: process.platform === 'win32' });
      return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch {
      throw new Error('luna-engine-failed');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  if (engine === 'opencode') {
    const output = await capture('opencode', ['run', '--title', 'system-one-cycle-judge', 'Return only the JSON object requested on standard input.'],
      prompt, { shell: process.platform === 'win32' });
    try { return JSON.parse(output.trim()); } catch { throw new Error('engine-invalid-json'); }
  }
  throw new Error('unknown-label-engine');
}

module.exports = { runStructured };
