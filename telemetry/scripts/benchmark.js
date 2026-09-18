#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { emitTelemetry } = require('../../hooks/scripts/lib/telemetry');
const { percentile } = require('./report');

function runBenchmark(count = 250) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-telemetry-bench-'));
  const file = path.join(root, 'events.jsonl');
  const overhead = [];
  try {
    for (let i = 0; i < count; i++) {
      const result = emitTelemetry({
        event: 'tool.observed',
        host: 'unknown',
        sessionId: 'session-benchmark',
        invocationId: 'invocation-benchmark',
        skillName: 'benchmark-skill',
        toolName: 'benchmark-tool',
        status: 'success',
        timing: { attributedToolDurationMs: 1 },
        reasonCodes: ['overhead-benchmark'],
      }, { file });
      if (!result.ok) throw new Error(result.error || 'telemetry write failed');
      overhead.push(result.overheadMs);
    }
    return {
      count,
      p50Ms: percentile(overhead, 50),
      p95Ms: percentile(overhead, 95),
      maxMs: Math.max(...overhead),
      bytes: fs.statSync(file).size,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const count = Number(process.argv[2] || 250);
  process.stdout.write(`${JSON.stringify(runBenchmark(Number.isInteger(count) && count > 0 ? count : 250), null, 2)}\n`);
}

module.exports = { runBenchmark };
