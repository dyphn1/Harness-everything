const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const helper = require('./test-helper');

console.log('\n[2n] opencode enforcement plugin: manifest parity and hook firing...');

const pluginDir = path.join(helper.root, 'opencode-plugin');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));

// 1. Manifest <-> disk parity. A hook file that no key points at is dead code
// the runtime will never load; a key pointing at a missing file is a broken
// install. Both shipped undetected before (issue #37).
const onDisk = fs.readdirSync(path.join(pluginDir, 'hooks')).filter(f => f.endsWith('.js')).sort();
const declared = [
  ...Object.values(manifest.hooks || {}),
  ...Object.values(manifest.onDemandHooks || {})
].map(p => path.basename(p)).sort();

helper.check(
  '2n. every hook file on disk is declared in the manifest',
  onDisk.every(f => declared.includes(f)),
  `undeclared: ${onDisk.filter(f => !declared.includes(f)).join(', ')}`
);
helper.check(
  '2n. every declared hook path exists on disk',
  declared.every(f => onDisk.includes(f)),
  `dangling: ${declared.filter(f => !onDisk.includes(f)).join(', ')}`
);
helper.check(
  '2n. no hook is declared twice across hooks and onDemandHooks',
  new Set(declared).size === declared.length,
  declared.join(', ')
);
helper.check(
  '2n. plugin version tracks the package version',
  manifest.version === require('../package.json').version,
  `plugin ${manifest.version} vs package ${require('../package.json').version}`
);

// 2. Hook firing. Two isolations are required, both load-bearing:
//   HOME -> temp, because the hooks persist to ~/.harness-state and an
//     un-redirected run would wipe a real session's circuit-breaker state;
//   cwd  -> temp, because verify.js resolves verification commands from
//     cwd/package.json and would otherwise re-enter `npm test` from inside
//     `npm test`. An empty cwd makes it take its documented skip path.
const fakeHome = helper.tempDir('.mechanism-test-opencode-home');
fs.mkdirSync(fakeHome, { recursive: true });

let firing;
try {
  firing = execFileSync(process.execPath, [path.join(pluginDir, 'test-hook-firing.js')], {
    encoding: 'utf8',
    cwd: fakeHome,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }
  });
} catch (err) {
  firing = (err.stdout || '') + (err.stderr || '');
}

helper.check('2n. all plugin hooks fire', firing.includes('HOOK FIRING VERIFICATION PASSED'), firing);
helper.check(
  '2n. circuit breaker forces reflection on the third repeat failure',
  firing.includes('force_reflection (three_failures) count=3'),
  firing
);
helper.check(
  '2n. circuit breaker hard-locks when the same failure returns after reflection',
  firing.includes('hard_lock (repeat_trip_after_reflection)'),
  firing
);
helper.check(
  '2n. hook state stayed inside the redirected HOME',
  fs.existsSync(path.join(fakeHome, '.harness-state')),
  `no .harness-state under ${fakeHome}`
);

helper.finish();
