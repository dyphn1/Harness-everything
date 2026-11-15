'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { REPO, dataPath, writeJson, runNode, assertPrivateDataDir } = require('./common');

const TASKS = ['validity', 'intent', 'tier'];

function processTreeRssMb(rootPid) {
  if (process.platform === 'win32') {
    const script = `$all=Get-CimInstance Win32_Process; $ids=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${Number(rootPid)}); do { $changed=$false; foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed=$true } } } while($changed); $total=($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Measure-Object WorkingSetSize -Sum).Sum; if($null -eq $total) { $total=0 }; [Console]::WriteLine($total)`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('rss-sample-failed');
    const bytes = Number(result.stdout.trim());
    if (!Number.isFinite(bytes)) throw new Error('rss-sample-failed');
    return bytes / (1024 * 1024);
  }

  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('rss-sample-failed');
  const rows = result.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/).map(Number))
    .filter(row => row.length === 3 && row.every(Number.isFinite));
  const children = new Map();
  const rssByPid = new Map();
  for (const [pid, ppid, rssKb] of rows) {
    rssByPid.set(pid, rssKb);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push([pid, rssKb]);
  }
  const pending = [Number(rootPid)];
  const found = new Set();
  let totalKb = 0;
  while (pending.length) {
    const pid = pending.pop();
    if (found.has(pid)) continue;
    found.add(pid);
    totalKb += rssByPid.get(pid) || 0;
    for (const [childPid, rssKb] of children.get(pid) || []) {
      pending.push(childPid);
    }
  }
  return totalKb / 1024;
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    if (result.status !== 0) { try { child.kill(); } catch { /* already exited */ } }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { try { child.kill('SIGKILL'); } catch { /* already exited */ } }
  }
}

function runGuarded(command, args, { maxRssMb = 6144, threads = 4, pollMs = 500, rssReader = processTreeRssMb } = {}) {
  if (!Number.isFinite(maxRssMb) || maxRssMb <= 0 || !Number.isInteger(threads) || threads < 1) {
    throw new Error('invalid resource guard limits');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
    let peakRssMb = 0;
    let killedForLimit = false;
    let monitorFailed = false;
    let sampling = false;
    let timer;
    const sample = () => {
      if (sampling || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
      sampling = true;
      try {
        const rss = rssReader(child.pid);
        if (!Number.isFinite(rss) || rss < 0) throw new Error('invalid-rss-sample');
        peakRssMb = Math.max(peakRssMb, rss);
        if (rss > maxRssMb && !killedForLimit) {
          killedForLimit = true;
          killTree(child);
        }
      } catch {
        monitorFailed = true;
        killTree(child);
      } finally { sampling = false; }
    };
    child.once('error', () => { clearInterval(timer); reject(new Error('training process could not start')); });
    child.once('close', (exitCode, signal) => {
      clearInterval(timer);
      resolve({ exitCode, signal, peakRssMb: Number(peakRssMb.toFixed(1)), maxRssMb, threads, killedForLimit, monitorFailed });
    });
    sample();
    timer = setInterval(sample, pollMs);
  });
}

function pythonExecutable() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

async function trainCycle({ dataDir, version, threads = 4, maxRssMb = 6144, run = runGuarded }) {
  const privateDir = assertPrivateDataDir(dataDir);
  const trainer = path.join(REPO, 'scripts', 'system-one-train.py');
  const calibrator = path.join(REPO, 'scripts', 'system-one-calibrate.js');
  const outputs = [];
  let trained = 0;
  let skipped = 0;

  for (const task of TASKS) {
    const source = dataPath(privateDir, 'training', task === 'validity' ? 'v1-validity' : 'v1');
    const out = dataPath(privateDir, 'training', 'runs', version, task);
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    const requiredFiles = ['harness-routing-v1.safetensors', 'harness-routing-v1.json', 'val-scores.jsonl', 'train-report.json', 'calibration.json', 'resource-guard.json'];
    const guardFile = path.join(out, 'resource-guard.json');
    if (requiredFiles.every(file => fs.existsSync(path.join(out, file)))) {
      const priorGuard = JSON.parse(fs.readFileSync(guardFile, 'utf8'));
      if (priorGuard.exitCode === 0 && !priorGuard.killedForLimit && !priorGuard.monitorFailed) {
        skipped++;
        outputs.push(`training/runs/${version}/${task}/resource-guard.json`);
        continue;
      }
    }
    const result = await run(pythonExecutable(), [trainer, '--data-dir', source, '--out', out, '--task', task, '--threads', String(threads)], {
      threads, maxRssMb,
    });
    const guard = { schemaVersion: 1, ...result, createdAt: new Date().toISOString() };
    writeJson(path.join(out, 'resource-guard.json'), guard);
    if (result.killedForLimit) throw new Error(`training ${task} exceeded the ${maxRssMb} MB RSS limit`);
    if (result.monitorFailed) throw new Error(`training ${task} RSS monitoring failed`);
    if (result.exitCode !== 0) throw new Error(`training ${task} failed`);
    runNode(calibrator, [path.join(out, 'val-scores.jsonl'), path.join(out, 'calibration.json'), '--task', task,
      '--catalog', path.join(out, 'train-report.json')]);
    trained++;
    outputs.push(`training/runs/${version}/${task}/resource-guard.json`);
  }
  return { trained, skipped, threads, maxRssMb, outputs };
}

module.exports = { runGuarded, processTreeRssMb, trainCycle, TASKS };
