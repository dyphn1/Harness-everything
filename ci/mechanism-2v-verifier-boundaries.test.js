const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('./test-helper');

const { assertContainedPath } = require('../scripts/lib/path-boundary');
const {
  commandMatches,
  commandsEqual,
  extractPatchPaths,
  patchPathsAuthorized,
} = require('../scripts/lib/execution-contract');

console.log('\n[2v] Verifier boundary contracts...');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2v-root-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2v-outside-'));

try {
  const workspace = path.join(root, 'workspace');
  const nested = path.join(workspace, 'nested');
  const outsideFile = path.join(outside, 'outside.txt');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(outsideFile, 'outside\n');

  helper.check(
    '2v. a normal nested path is inside its physical boundary',
    assertContainedPath(workspace, path.join(nested, 'new.txt')).target.endsWith(path.join('nested', 'new.txt'))
  );

  helper.check(
    '2v. lexical parent traversal is rejected',
    (() => {
      try {
        assertContainedPath(workspace, path.join(workspace, '..', 'escape.txt'));
        return false;
      } catch (error) {
        return error.code === 'PATH_OUTSIDE_BOUNDARY';
      }
    })()
  );

  const link = path.join(workspace, 'linked');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  helper.check(
    '2v. a junction/symlink inside the boundary cannot escape it',
    (() => {
      try {
        assertContainedPath(workspace, path.join(link, 'new.txt'));
        return false;
      } catch (error) {
        return error.code === 'LINK_COMPONENT_IN_BOUNDARY';
      }
    })()
  );

  helper.check(
    '2v. a missing leaf reached through a link is rejected before writing',
    (() => {
      try {
        assertContainedPath(workspace, path.join(link, 'missing', 'new.txt'));
        return false;
      } catch (error) {
        return error.code === 'LINK_COMPONENT_IN_BOUNDARY';
      }
    })()
  );

  const linkedInsideTarget = path.join(workspace, 'real-inside');
  const linkedInside = path.join(workspace, 'linked-inside');
  fs.mkdirSync(linkedInsideTarget, { recursive: true });
  fs.symlinkSync(linkedInsideTarget, linkedInside, process.platform === 'win32' ? 'junction' : 'dir');
  helper.check(
    '2v. a link component is rejected even when its target stays inside the boundary',
    (() => {
      try {
        assertContainedPath(workspace, path.join(linkedInside, 'new.txt'));
        return false;
      } catch (error) {
        return error.code === 'LINK_COMPONENT_IN_BOUNDARY';
      }
    })()
  );

  const upperCaseWorkspace = workspace.toUpperCase();
  helper.check(
    '2v. Windows path casing does not change containment',
    process.platform !== 'win32' || assertContainedPath(upperCaseWorkspace, path.join(workspace, 'nested', 'case.txt')).target
  );

  helper.check('2v. exact commands match after harmless whitespace normalization', commandsEqual(' npm   test ', 'npm test'));
  helper.check('2v. invalid boundary arguments use a stable error code', (() => {
    try {
      assertContainedPath(null, workspace);
      return false;
    } catch (error) {
      return error.code === 'INVALID_BOUNDARY_PATH';
    }
  })());
  helper.check('2v. a command containing the expected text is not an exact match', !commandsEqual('echo /tmp/preflight.js', 'preflight.js'));
  helper.check('2v. extra command arguments are not silently accepted', !commandsEqual('npm test --coverage', 'npm test'));
  helper.check('2v. argv commands compare each argument exactly', commandsEqual(['node', 'ci/test.js'], ['node', 'ci/test.js']) && !commandsEqual(['node', 'ci/test.js', '--verbose'], ['node', 'ci/test.js']));
  helper.check('2v. a real node script invocation can use a basename expectation', commandMatches('node C:\\temp\\preflight.js', 'preflight.js'));
  helper.check('2v. a non-launcher mention cannot satisfy a script expectation', !commandMatches('echo C:\\temp\\preflight.js', 'preflight.js'));

  const patch = [
    '*** Begin Patch',
    '*** Update File: behavioral-evals/run.js',
    '@@',
    '*** Update File: ci/mechanism-2v-verifier-boundaries.test.js',
    '@@',
    '*** End Patch',
  ].join('\n');
  helper.check(
    '2v. patch parser returns every touched path',
    JSON.stringify(extractPatchPaths(patch)) === JSON.stringify([
      'behavioral-evals/run.js',
      'ci/mechanism-2v-verifier-boundaries.test.js',
    ])
  );
  helper.check(
    '2v. a multi-file patch is authorized only when every path is allowed',
    patchPathsAuthorized(patch, new Set(['behavioral-evals/run.js', 'ci/mechanism-2v-verifier-boundaries.test.js']))
  );
  helper.check(
    '2v. one unrelated path rejects the whole patch',
    !patchPathsAuthorized(patch, new Set(['behavioral-evals/run.js']))
  );
  helper.check(
    '2v. traversal paths are never authorized even when allowlisted',
    !patchPathsAuthorized('*** Update File: ../escape.js\n', new Set(['../escape.js']))
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

helper.finish();
