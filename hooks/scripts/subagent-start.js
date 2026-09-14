#!/usr/bin/env node
'use strict';

// OpenAI's SubagentStart event has no Claude Task tool name. The shared guard
// records the baseline, while this adapter adds the subagent's scope reminder
// through the OpenAI hook output contract.
process.on('exit', () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: [
        'Harness subagent scope guard is active.',
        'Keep this worker within the requested scope and report every changed path before handoff.'
      ].join('\n')
    }
  }) + '\n');
});

require('./subagent-scope-guard');
