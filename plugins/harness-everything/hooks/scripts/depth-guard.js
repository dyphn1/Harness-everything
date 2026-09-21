#!/usr/bin/env node
/**
 * Depth Guard (PreToolUse: Edit|Write)
 * Claude Code already refuses to Edit a file that wasn't Read first in the
 * same session - that's native behavior, not something this hook needs to
 * re-check. The gap is Write: it happily overwrites an existing file with
 * no prior Read at all. This hook observes that gap and emits the semantic
 * MUST to establish current target state before destructive overwrite.
 * Fails open on parse/lookup errors and does not create a cognitive lock.
 */
const fs = require('fs');
const path = require('path');

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    if (payload.tool_name !== 'Write') {
      process.exit(0);
    }

    const filePath = payload.tool_input && payload.tool_input.file_path;
    if (!filePath || !fs.existsSync(filePath)) {
      // New file - nothing to have read first.
      process.exit(0);
    }

    const transcriptPath = payload.transcript_path;
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      // Can't verify either way - fail open.
      process.exit(0);
    }

    const target = path.resolve(filePath).toLowerCase();
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);

    const wasRead = lines.some(line => {
      try {
        const entry = JSON.parse(line);
        const content = entry && entry.message && entry.message.content;
        if (!Array.isArray(content)) return false;
        return content.some(block => {
          if (!block || block.type !== 'tool_use' || block.name !== 'Read') return false;
          const readPath = block.input && block.input.file_path;
          return readPath && path.resolve(readPath).toLowerCase() === target;
        });
      } catch (e) {
        return false;
      }
    });

    if (!wasRead) {
      console.error(`[Depth Reminder]: "${filePath}" already exists but hasn't been Read in this session.`);
      console.error(`Semantic MUST: establish the current target state before a destructive whole-file overwrite.`);
      console.error(`Read the file first (even a quick pass), or use Edit for a targeted change. This reminder is fail-open rather than a persistent lock.`);
      process.exit(0);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
