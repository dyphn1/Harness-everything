#!/usr/bin/env node
'use strict';

// The shared guard emits exit code 2 and stderr when a subagent changed files;
// OpenAI/Codex treats that as a continuation signal for SubagentStop.
require('./subagent-scope-guard');
