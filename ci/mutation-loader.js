'use strict';

const fs = require('fs');
const Module = require('module');
const path = require('path');

const target = process.env.HARNESS_MUTATION_TARGET && path.resolve(process.env.HARNESS_MUTATION_TARGET);
const mutation = process.env.HARNESS_MUTATION;
const originalLoader = Module._extensions['.js'];

const mutations = {
  'path-boundary': (source) => source.replace(
    '  assertNoLinkComponents(root, candidate);',
    '  // mutation: skip physical link-component validation'
  ),
  'execution-contract': (source) => source.replace(
    '  return left !== null && left === right;',
    '  return left !== null; // mutation: accept every non-null command'
  ),
  'evidence-tool': (source) => source
    .replace('  const containedDestination = assertContainedPath(archiveRoot, destination).target;', '  const containedDestination = destination; // mutation: skip destination boundary')
    .replace('  const contained = assertContainedPath(archiveRoot, target).target;', '  const contained = target; // mutation: skip archive write boundary'),
  'scaffold-migration': (source) => source.replace(
    '  assertContainedPath(workspaceRoot, legacyRoot);',
    '  // mutation: skip linked legacy-root validation'
  ),
  'installer-global': (source) => source.replace(
    'const workspaceRoot = detectedWorkspaceRoot || path.resolve(process.cwd());',
    'const workspaceRoot = detectedWorkspaceRoot; // mutation: restore null global workspace'
  ),
  'transcript-command': (source) => source.replace(
    '    if (target.command !== undefined && (!isObject(call.input) || !commandMatches(call.input.command, target.command))) return false;',
    '    // mutation: ignore command qualifiers'
  ),
  'runner-fixture': (source) => source.replace(
    '    const relative = normalizeRepoPath(file && file.path);',
    '    const relative = file && file.path; // mutation: skip fixture path normalization'
  ),
  'workspace-identity': (source) => source.replace(
    '  if (!workspaceRoot) return UNBOUND_WORKSPACE_KEY;',
    '  if (!workspaceRoot) return path.basename(process.cwd()); // mutation: derive unbound identity from cwd'
  ),
};

if (target && mutation && mutations[mutation]) {
  const transform = mutations[mutation];
  Module._extensions['.js'] = function loadWithMutation(mod, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    if (path.resolve(filename) === target) {
      const mutated = transform(source);
      if (mutated === source) throw new Error(`mutation was not applied to ${filename}`);
      mod._compile(mutated, filename);
      return;
    }
    originalLoader(mod, filename);
  };
}
