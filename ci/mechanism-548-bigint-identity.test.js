'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.resolve(__dirname, '..');
const REPORT_WRITER = path.join(ROOT, 'scripts', 'report-writer.js');
const ERRORS_SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const LARGE = 2n ** 60n;

function canonical(file) {
  return fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file);
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(canonical(os.tmpdir()), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runNode(args, { preload, cwd = ROOT, env = process.env } = {}) {
  return spawnSync(process.execPath, [...(preload ? ['-r', preload] : []), ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

function writeStatPreload(file, body) {
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

test('548 report-writer allows distinct files whose 64-bit dev/ino collide as Number (#546 witness)', t => {
  assert.equal(Number(LARGE), Number(LARGE + 1n), 'fixture IDs must collide when converted to Number');

  const dir = tempDir(t, 'harness-548-report-');
  const raw = path.join(dir, 'raw.txt');
  const output = path.join(dir, 'report.md');
  fs.writeFileSync(raw, 'First\nSTATUS: DONE\n');
  fs.writeFileSync(output, 'Previous\nSTATUS: DONE\n');

  for (const scenario of ['distinct-ino', 'distinct-dev', 'same-alias']) {
    fs.writeFileSync(output, 'Previous\nSTATUS: DONE\n');
    const preload = writeStatPreload(path.join(dir, `preload-${scenario}.cjs`), `
      'use strict';
      const fs = require('node:fs');
      const path = require('node:path');
      const norm = p => {
        const resolved = path.resolve(String(p));
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      };
      const rawKey = norm(${JSON.stringify(raw)});
      const outKey = norm(${JSON.stringify(output)});
      const large = ${LARGE}n;
      const scenario = ${JSON.stringify(scenario)};
      const origStatSync = fs.statSync;
      fs.statSync = function (file, options) {
        const result = origStatSync.call(this, file, options);
        const key = norm(file);
        if (key === rawKey || key === outKey) {
          const isOut = key === outKey;
          const conv = value => (options && options.bigint ? value : Number(value));
          result.ino = conv(large + (isOut && scenario === 'distinct-ino' ? 1n : 0n));
          result.dev = conv(large + (isOut && scenario === 'distinct-dev' ? 1n : 0n));
        }
        return result;
      };
    `);

    const result = runNode(
      [REPORT_WRITER, 'write', '--output', output, '--status', 'DONE', '--from-codex-output', raw],
      { preload }
    );

    if (scenario === 'same-alias') {
      assert.notEqual(result.status, 0, 'true alias must still be rejected');
      assert.match(result.stderr, /report-writer: output aliases an input file/);
      assert.equal(fs.readFileSync(output, 'utf8'), 'Previous\nSTATUS: DONE\n');
    } else {
      assert.equal(result.status, 0, `${scenario} failed: ${result.stderr || result.stdout}`);
      assert.equal(fs.readFileSync(output, 'utf8'), 'First\nSTATUS: DONE\n');
    }
  }
});

test('548 report-writer rejects a zero-inode parent-directory alias and preserves the raw input', t => {
  const dir = tempDir(t, 'harness-548-alias-');
  const files = path.join(dir, 'files');
  fs.mkdirSync(files);
  const raw = path.join(files, 'raw.txt');
  const aliasDir = path.join(dir, 'alias-dir');
  const aliased = path.join(aliasDir, 'raw.txt');
  fs.symlinkSync(files, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
  const rawBytes = Buffer.from('First\n');
  fs.writeFileSync(raw, rawBytes);

  // Simulate a stat backend that reports inode zero for Number and bigint stats alike.
  const preload = writeStatPreload(path.join(dir, 'preload-zero-ino.cjs'), `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const norm = p => {
      const resolved = path.resolve(String(p));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const rawKey = norm(${JSON.stringify(raw)});
    const aliasKey = norm(${JSON.stringify(aliased)});
    const origStatSync = fs.statSync;
    fs.statSync = function (file, options) {
      const result = origStatSync.call(this, file, options);
      const key = norm(file);
      if (key === rawKey || key === aliasKey) {
        result.ino = options && options.bigint ? 0n : 0;
      }
      return result;
    };
  `);

  const result = runNode(
    [REPORT_WRITER, 'write', '--output', aliased, '--status', 'DONE', '--from-codex-output', raw],
    { preload }
  );

  assert.notEqual(result.status, 0, 'zero-inode directory alias must be rejected');
  assert.match(result.stderr, /report-writer: output aliases an input file/);
  assert.deepEqual(fs.readFileSync(raw), rawBytes, 'raw input bytes must be preserved');
});

test('548 errors-sync detects a swapped index whose 64-bit ino collides as Number', t => {
  assert.equal(Number(LARGE), Number(LARGE + 1n), 'fixture IDs must collide when converted to Number');

  const root = tempDir(t, 'harness-548-errors-sync-');
  const errorsDir = path.join(root, '.agents', 'harness-everything', 'errors');
  fs.mkdirSync(errorsDir, { recursive: true });
  fs.writeFileSync(path.join(errorsDir, 'E-0001-sample.md'), [
    '---',
    'id: E-0001',
    'signature: sample-error',
    'class: test',
    'title: "Sample"',
    'scope: in',
    'status: open',
    '---',
    '',
    'Body.',
    '',
  ].join('\n'));

  const initial = runNode([ERRORS_SYNC, '--root', root]);
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  const indexFile = path.join(errorsDir, 'index.jsonl');
  assert.equal(fs.existsSync(indexFile), true);

  // Control: consistent bigint identity (> MAX_SAFE_INTEGER) passes both write and --check.
  const samePreload = writeStatPreload(path.join(root, 'preload-same.cjs'), `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const norm = p => {
      const resolved = path.resolve(String(p));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const indexKey = norm(${JSON.stringify(indexFile)});
    const large = ${LARGE}n;
    const origLstat = fs.lstatSync;
    const origFstat = fs.fstatSync;
    const origOpen = fs.openSync;
    const indexFds = new Set();
    fs.openSync = function (file, ...rest) {
      const fd = origOpen.call(this, file, ...rest);
      if (norm(file) === indexKey) indexFds.add(fd);
      return fd;
    };
    fs.lstatSync = function (file, options) {
      const res = origLstat.call(this, file, options);
      if (norm(file) === indexKey) {
        const conv = value => (options && options.bigint ? value : Number(value));
        res.dev = conv(large);
        res.ino = conv(large);
      }
      return res;
    };
    fs.fstatSync = function (fd, options) {
      const res = origFstat.call(this, fd, options);
      if (indexFds.has(fd)) {
        const conv = value => (options && options.bigint ? value : Number(value));
        res.dev = conv(large);
        res.ino = conv(large);
      }
      return res;
    };
  `);
  const sameWrite = runNode([ERRORS_SYNC, '--root', root], { preload: samePreload });
  assert.equal(sameWrite.status, 0, `same-identity write failed: ${sameWrite.stderr || sameWrite.stdout}`);
  const sameCheck = runNode([ERRORS_SYNC, '--check', '--root', root], { preload: samePreload });
  assert.equal(sameCheck.status, 0, `same-identity check failed: ${sameCheck.stderr || sameCheck.stdout}`);

  // Regression: lstatSync reports large, fstatSync reports large + 1n (Number-equal, BigInt-distinct).
  const swapPreload = writeStatPreload(path.join(root, 'preload-swap.cjs'), `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const norm = p => {
      const resolved = path.resolve(String(p));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const indexKey = norm(${JSON.stringify(indexFile)});
    const large = ${LARGE}n;
    const origLstat = fs.lstatSync;
    const origFstat = fs.fstatSync;
    const origOpen = fs.openSync;
    const indexFds = new Set();
    fs.openSync = function (file, ...rest) {
      const fd = origOpen.call(this, file, ...rest);
      if (norm(file) === indexKey) indexFds.add(fd);
      return fd;
    };
    fs.lstatSync = function (file, options) {
      const res = origLstat.call(this, file, options);
      if (norm(file) === indexKey) {
        const conv = value => (options && options.bigint ? value : Number(value));
        res.dev = conv(large);
        res.ino = conv(large);
      }
      return res;
    };
    fs.fstatSync = function (fd, options) {
      const res = origFstat.call(this, fd, options);
      if (indexFds.has(fd)) {
        const conv = value => (options && options.bigint ? value : Number(value));
        res.dev = conv(large);
        res.ino = conv(large + 1n);
      }
      return res;
    };
  `);
  const swapCheck = runNode([ERRORS_SYNC, '--check', '--root', root], { preload: swapPreload });
  assert.notEqual(swapCheck.status, 0, 'swapped index with Number-colliding 64-bit ino must be rejected');
  assert.match(swapCheck.stderr, /target index changed while it was being read/);
});

// --- Guard: every non-test JS `.ino` access must originate from a `{ bigint: true }` stat call ---

const STAT_METHODS = new Set(['statSync', 'lstatSync', 'fstatSync']);
const EXCLUDED_DIRS = new Set(['.git', '.w', 'node_modules', 'ci', 'evals', 'benchmarks', 'behavioral-evals']);

function listNonTestJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      listNonTestJsFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isStatCall(node) {
  return node && node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.property.type === 'Identifier'
    && STAT_METHODS.has(node.callee.property.name);
}

function hasBigIntTrueOption(callNode) {
  const opts = callNode.arguments[1];
  if (!opts || opts.type !== 'ObjectExpression') return false;
  return opts.properties.some(prop =>
    prop.type === 'Property'
    && !prop.computed
    && ((prop.key.type === 'Identifier' && prop.key.name === 'bigint')
      || (prop.key.type === 'Literal' && prop.key.value === 'bigint'))
    && prop.value.type === 'Literal'
    && prop.value.value === true
  );
}

function parseProgram(source, file) {
  const clean = source.startsWith('#!') ? `//${source.slice(2)}` : source;
  try {
    return acorn.parse(clean, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  } catch (_) {
    return acorn.parse(clean, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  }
}

function findNonBigIntInoViolations(source, label) {
  if (!source.includes('.ino')) return [];
  const ast = parseProgram(source, label);

  // Collect function declarations and expressions by name, plus per-scope variable bindings.
  const functions = new Map();
  const callsByName = new Map();
  const bindingsByScope = new Map(); // scopeNode -> Map<varName, Expression[]>
  const parentOf = new Map();

  function recordBinding(scopeNode, name, expr) {
    if (!bindingsByScope.has(scopeNode)) bindingsByScope.set(scopeNode, new Map());
    const map = bindingsByScope.get(scopeNode);
    if (!map.has(name)) map.set(name, []);
    if (expr) map.get(name).push(expr);
  }

  function isFnNode(node) {
    return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
  }

  function isScopeNode(node) {
    return node.type === 'Program' || node.type === 'BlockStatement' || isFnNode(node);
  }

  function nearestScope(ancestors) {
    return [...ancestors].reverse().find(isScopeNode) || ast;
  }

  function enclosingFn(ancestors) {
    return [...ancestors].reverse().find(isFnNode) || ast;
  }

  function enclosingScope(ancestors) {
    return [...ancestors].slice(0, -1).reverse().find(isScopeNode) || ast;
  }

  // Pass 1: build scope tree, function table, and variable declarations.
  walk.ancestor(ast, {
    FunctionDeclaration(node, ancestors) {
      if (node.id) functions.set(node.id.name, node);
      parentOf.set(node, enclosingScope(ancestors));
    },
    BlockStatement(node, ancestors) {
      parentOf.set(node, enclosingScope(ancestors));
    },
    FunctionExpression(node, ancestors) {
      parentOf.set(node, enclosingScope(ancestors));
    },
    ArrowFunctionExpression(node, ancestors) {
      parentOf.set(node, enclosingScope(ancestors));
    },
    VariableDeclarator(node, ancestors) {
      if (node.id.type !== 'Identifier') return;
      const decl = ancestors[ancestors.length - 2];
      const scope = decl && decl.kind === 'var' ? enclosingFn(ancestors) : nearestScope(ancestors);
      recordBinding(scope, node.id.name, node.init || null);
    },
  });

  // Pass 2: attach assignments to their declaring lexical scope and index calls.
  walk.ancestor(ast, {
    AssignmentExpression(node, ancestors) {
      if (node.left.type !== 'Identifier') return;
      const fn = enclosingFn(ancestors);
      let cursor = nearestScope(ancestors);
      while (cursor) {
        if (bindingsByScope.get(cursor)?.has(node.left.name)) {
          recordBinding(cursor, node.left.name, node.right);
          return;
        }
        if (cursor === fn) break;
        cursor = parentOf.get(cursor);
      }
      recordBinding(fn, node.left.name, node.right);
    },
    CallExpression(node, ancestors) {
      if (node.callee.type === 'Identifier') {
        if (!callsByName.has(node.callee.name)) callsByName.set(node.callee.name, []);
        callsByName.get(node.callee.name).push({ call: node, scope: nearestScope(ancestors), fn: enclosingFn(ancestors) });
      }
    },
  });

  function isNullLiteral(expr) {
    return expr && expr.type === 'Literal' && expr.value === null;
  }

  function verifyExpr(expr, scopeNode, fnNode, propPath, seen) {
    if (!expr) return { ok: false, reason: 'missing initializer' };
    const key = `${expr.start}:${expr.end}:${propPath.join('.')}`;
    if (seen.has(key)) return { ok: true };
    seen.add(key);

    if (isNullLiteral(expr)) return { ok: true };

    if (isStatCall(expr)) {
      if (propPath.length !== 0) return { ok: false, reason: 'unexpected property chain on stat call' };
      return hasBigIntTrueOption(expr)
        ? { ok: true }
        : { ok: false, reason: `${expr.callee.property.name}() without { bigint: true } at line ${expr.loc.start.line}` };
    }

    if (expr.type === 'ObjectExpression' && propPath.length > 0) {
      const [head, ...rest] = propPath;
      const prop = expr.properties.find(p =>
        p.type === 'Property' && !p.computed
        && ((p.key.type === 'Identifier' && p.key.name === head)
          || (p.key.type === 'Literal' && p.key.value === head))
      );
      if (!prop) return { ok: false, reason: `object literal missing property ${head}` };
      return verifyExpr(prop.value, scopeNode, fnNode, rest, seen);
    }

    if (expr.type === 'Identifier') {
      return verifyIdentifier(expr.name, scopeNode, fnNode, propPath, seen);
    }

    if (expr.type === 'MemberExpression' && !expr.computed && expr.property.type === 'Identifier') {
      return verifyExpr(expr.object, scopeNode, fnNode, [expr.property.name, ...propPath], seen);
    }

    if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier') {
      const targetFn = functions.get(expr.callee.name);
      if (!targetFn) return { ok: false, reason: `untraced call ${expr.callee.name}()` };
      const returns = [];
      walk.ancestor(targetFn.body, {
        ReturnStatement(ret, ancestors) {
          if (ret.argument) returns.push({ arg: ret.argument, scope: nearestScope(ancestors) });
        },
      });
      if (!returns.length) return { ok: false, reason: `${expr.callee.name}() has no return value` };
      let verifiedStat = false;
      for (const ret of returns) {
        if (isNullLiteral(ret.arg)) continue;
        const check = verifyExpr(ret.arg, ret.scope, targetFn, propPath, seen);
        if (!check.ok) return check;
        verifiedStat = true;
      }
      return verifiedStat ? { ok: true } : { ok: false, reason: `${expr.callee.name}() only returns null` };
    }

    return { ok: false, reason: `untraced expression (${expr.type}) at line ${expr.loc.start.line}` };
  }

  function verifyIdentifier(name, scopeNode, fnNode, propPath, seen) {
    const key = `id:${scopeNode.start}:${name}:${propPath.join('.')}`;
    if (seen.has(key)) return { ok: true };
    seen.add(key);

    // Walk lexical scopes up to fnNode (inclusive).
    let cursor = scopeNode;
    while (cursor) {
      const bindings = bindingsByScope.get(cursor)?.get(name);
      if (bindings && bindings.length > 0) {
        let verified = false;
        for (const expr of bindings) {
          if (isNullLiteral(expr)) continue;
          const check = verifyExpr(expr, cursor, fnNode, propPath, seen);
          if (!check.ok) return check;
          verified = true;
        }
        return verified ? { ok: true } : { ok: false, reason: `${name} only assigned null` };
      }
      if (cursor === fnNode) break;
      cursor = parentOf.get(cursor);
    }

    // Check if identifier is a parameter of fnNode; trace all call sites.
    if (fnNode.params) {
      const paramIndex = fnNode.params.findIndex(p => p.type === 'Identifier' && p.name === name);
      if (paramIndex !== -1 && fnNode.id) {
        const callSites = callsByName.get(fnNode.id.name) || [];
        if (!callSites.length) return { ok: false, reason: `parameter ${name} of ${fnNode.id.name}() has no call sites` };
        for (const { call, scope, fn } of callSites) {
          const arg = call.arguments[paramIndex];
          const check = verifyExpr(arg, scope, fn, propPath, seen);
          if (!check.ok) return check;
        }
        return { ok: true };
      }
    }

    return { ok: false, reason: `untraced identifier ${name}` };
  }

  const violations = [];
  walk.ancestor(ast, {
    MemberExpression(node, ancestors) {
      if (node.computed || node.property.type !== 'Identifier' || node.property.name !== 'ino') return;
      const scopeNode = nearestScope(ancestors);
      const fnNode = enclosingFn(ancestors);
      const check = verifyExpr(node.object, scopeNode, fnNode, [], new Set());
      if (!check.ok) {
        violations.push(`${label}:${node.loc.start.line}: ${check.reason}`);
      }
    },
  });
  return violations;
}

test('548 guard: every non-test JS .ino access comes from a { bigint: true } stat', () => {
  // Self-check: guard must reject a new Number-ino comparison and accept a bigint one.
  const badSample = `
    const fs = require('node:fs');
    function same(a, b) {
      const x = fs.statSync(a);
      const y = fs.statSync(b);
      return x.dev === y.dev && x.ino === y.ino;
    }
  `;
  const goodSample = `
    const fs = require('node:fs');
    function same(a, b) {
      const x = fs.statSync(a, { bigint: true });
      const y = fs.statSync(b, { bigint: true });
      return x.ino > 0n && x.dev === y.dev && x.ino === y.ino;
    }
  `;
  assert.ok(findNonBigIntInoViolations(badSample, 'bad.js').length > 0, 'guard must fail on Number-ino comparison');
  assert.deepEqual(findNonBigIntInoViolations(goodSample, 'good.js'), [], 'guard must accept bigint-ino comparison');

  const files = listNonTestJsFiles(ROOT).sort();
  const checkedWithIno = [];
  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('.ino')) continue;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    checkedWithIno.push(rel);
    violations.push(...findNonBigIntInoViolations(source, rel));
  }

  assert.ok(checkedWithIno.length >= 4, `expected to inspect inventoried .ino files; found ${checkedWithIno.length}`);
  assert.deepEqual(violations, [], `non-bigint .ino stat usage found:\n${violations.join('\n')}`);
});
