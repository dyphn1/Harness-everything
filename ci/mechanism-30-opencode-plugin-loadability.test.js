const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');
const helper = require('./test-helper');

const root = helper.root;
const sourceFile = path.join(root, 'opencode-plugin', 'index.mjs');
const runnerFile = path.join(root, 'behavioral-evals', 'run-with-plugin.js');
const readmeFile = path.join(root, 'opencode-plugin', 'README.md');

function pluginInstallTargets(text) {
  return [...text.matchAll(/(?:\.opencode|(?:~[\\/])?\.config[\\/]opencode)[\\/]plugins?[\\/][\w.@/-]+/g)]
    .map(match => match[0].replace(/[\\/]+$/, ''));
}

function invalidTargets(text) {
  return pluginInstallTargets(text).filter(target => !/\.(?:js|ts)$/.test(target));
}

function installStatement(text) {
  const statements = text.match(/fs\.copyFileSync\(path\.join\(PLUGIN_DIR,[^;]+;/g) || [];
  assert.strictEqual(statements.length, 1, 'Expected one canonical plugin installation');
  return statements[0];
}

function installIntoTempDir(text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-loadability-'));
  try {
    vm.runInNewContext(installStatement(text), {
      fs, path,
      PLUGIN_DIR: path.dirname(sourceFile),
      opencodePluginsDir: directory,
    }, { timeout: 1000 });
    assert.deepStrictEqual(fs.readdirSync(directory), ['harness-enforcement.js']);
    const copiedFile = path.join(directory, 'harness-enforcement.js');
    assert.ok(fs.readFileSync(sourceFile).equals(fs.readFileSync(copiedFile)));
    return { directory, copiedFile };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function verifyInstall(text) {
  const { directory } = installIntoTempDir(text);
  fs.rmSync(directory, { recursive: true, force: true });
}

async function verifyCopiedEntrypoint(text) {
  const { directory, copiedFile } = installIntoTempDir(text);
  try {
    // Scratch copy uses .js outside a module-typed package; add package.json after
    // verifying the installed directory contains only harness-enforcement.js.
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
    const mod = await import(pathToFileURL(copiedFile).href);
    assert.deepStrictEqual(Object.keys(mod).sort(), ['default']);
    assert.ok(mod.default && typeof mod.default.setup === 'function', 'Expected default.setup to be a function');
    assert.strictEqual(Object.hasOwn(mod.default, 'server'), false, 'Expected no default.server on V2 entrypoint');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function isWorktreeRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch (_) {
    return false;
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.git', '.worktrees'].includes(entry.name) || entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === 'benchmarks/results' || relative === 'CHANGELOG.md') return [];
    if (relative === '.worktrees' || relative.startsWith('.worktrees/')) return [];
    if (entry.isDirectory()) {
      // Skip linked worktrees / nested checkouts: a `.git` file marks a
      // linked worktree root, a `.git` dir marks a nested repo. Either way
      // the content belongs to another checkout, not this one (#170).
      if (isWorktreeRoot(file)) return [];
      return walk(file);
    }
    return [file];
  });
}

(async () => {
  try {
    const runner = fs.readFileSync(runnerFile, 'utf8');
    verifyInstall(runner);
    assert.throws(() => verifyInstall(runner.replace('harness-enforcement.js', 'harness-enforcement.mjs')));
    assert.throws(() => verifyInstall(runner.replace("'index.mjs'", "'plugin.json'")));

    for (const extension of ['mjs', 'cjs', 'mts', 'cts', 'jsx', 'tsx', 'json']) {
      for (const base of ['.opencode/plugins/', '~/.config/opencode/plugins/']) {
        assert.strictEqual(invalidTargets(`${base}example.${extension}`).length, 1);
      }
    }
    for (const base of ['.opencode/plugins/', '~/.config/opencode/plugins/']) {
      assert.strictEqual(invalidTargets(`${base}example`).length, 1);
      assert.deepStrictEqual(invalidTargets(`${base}example.js`), []);
      assert.deepStrictEqual(invalidTargets(`${base}example.ts`), []);
    }
    assert.deepStrictEqual(invalidTargets('opencode-plugin/index.mjs .opencode/plugins/example.js'), []);

    const scanViolations = (readText = file => fs.readFileSync(file, 'utf8')) => {
      const violations = [];
      for (const file of walk(root).filter(file => /\.(?:md|js|mjs|json|jsonc|yml|yaml|txt)$/.test(file))) {
        const text = readText(file);
        for (const target of invalidTargets(text)) violations.push(`${path.relative(root, file)}: ${target}`);
      }
      return violations;
    };
    assert.deepStrictEqual(scanViolations(), [], 'Unsupported OpenCode install destinations; only .js/.ts are auto-discovered');

    const scannedFiles = walk(root);
    assert.ok(scannedFiles.includes(readmeFile), 'Tracked OpenCode README must remain in the repository scan');
    const plantedTarget = '.opencode/plugins/' + 'negative-control.mjs';
    const planted = scanViolations(file => {
      const text = fs.readFileSync(file, 'utf8');
      return file === readmeFile ? text + '\n' + plantedTarget + '\n' : text;
    });
    assert.ok(
      planted.some(item => item === `${path.relative(root, readmeFile)}: ${plantedTarget}`),
      'Scanner negative control must fail when a tracked file contains an unsupported .mjs install target'
    );

    const readme = fs.readFileSync(readmeFile, 'utf8');
    for (const destination of ['.opencode/plugins/harness-enforcement.js', '~/.config/opencode/plugins/harness-enforcement.js']) {
      assert.ok(readme.includes(`cp opencode-plugin/index.mjs ${destination}`));
    }
    helper.check('30. real install statement produces a byte-identical .js/.ts-discoverable file; non-allowlisted filenames and content mutations fail', true);

    try {
      await verifyCopiedEntrypoint(runner);
      helper.check('30. copied .js entrypoint exports only the V2 default definition with setup and no server', true);
    } catch (error) {
      helper.check('30. copied .js entrypoint exports only the V2 default definition with setup and no server', false, error.stack);
    }
    helper.finish();
  } catch (error) {
    helper.check('30. OpenCode installation contract', false, error.stack);
    helper.finish();
  }
})();
