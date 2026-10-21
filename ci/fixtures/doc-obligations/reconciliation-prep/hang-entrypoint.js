'use strict';
// Test-only fixture for the #325 3b preparation suite. Substituted for one replay entrypoint by a test copy of the
// corpus. It never returns and ignores SIGTERM, so only an uncatchable kill (SIGKILL) can stop it. Not production code.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
