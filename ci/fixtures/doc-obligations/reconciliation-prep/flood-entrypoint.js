'use strict';
// Test-only fixture for the #325 3b preparation suite. Substituted for one replay entrypoint by a test copy of the
// corpus. It writes stdout without bound, so the child output bound must stop it. Not production code.
const chunk = 'x'.repeat(1024 * 1024);
setInterval(() => { process.stdout.write(chunk); }, 0);
