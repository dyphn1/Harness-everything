'use strict';

// C1 is deliberately an isolation/API trial, not a JavaScript static-analysis engine. It
// compiles the exact caller-supplied source pair in a restricted VM, exercises the returned
// capture views with synthetic values, and checks the reviewed API/context/call-site policy.
// Dormant statements inside an already-authorized compatibility method are outside this
// method's proof and must be caught by the C2 structural supplement.
const vm = require('node:vm');
const fs = require('node:fs');
const { spawnWithSnapshotInput } = require('./snapshot-stdin');

// C1 runs in CI across hosted runners; keep enough headroom for slower macOS startup and VM checks.
const C1_EXECUTION_TIMEOUT_MS = 10_000;
// Infinite-loop controls opt into a shorter deadline through the argv-gated test entry below.
const C1_TEST_EXECUTION_TIMEOUT_MS = 1_000;
const C1_EXECUTION_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

const COVERAGE_IDS = Object.freeze([
  'source-pair',
  'module-exports',
  'evaluator-context-surface',
  'invocation-capabilities',
  'obligation-capabilities',
  'capture-return-schemas',
  'returned-view-ownership',
  'capture-call-sites',
  'compatibility-ledger'
]);

function checkBoundary(input) {
  if (input && input.method === 'ast') {
    try {
      return runBoundaryCheck(input);
    } catch {
      return failClosedResult(input, 'CHECKER_FAIL_CLOSED');
    }
  }

  return checkIsolationBoundary(input, C1_EXECUTION_TIMEOUT_MS);
}

function checkIsolationBoundary(input, timeoutMs) {
  try {
    // C1 calls VM-created functions and inspects their returned objects from host code; bound the
    // entire isolation run so calls and proxy-backed ownership traversal are all killable.
    // This production call selects only the fixed isolation entry; the timeout test entry is
    // reachable only by direct CLI invocation and is never derived from caller input.
    const child = spawnC1Child(['--c1-isolation-child'], JSON.stringify(input === undefined ? null : input), timeoutMs);
    if (child.error && child.error.code === 'ETIMEDOUT') {
      return failClosedResult(input, 'CHECKER_EXECUTION_TIMEOUT');
    }
    if (child.error || child.status !== 0 || child.signal) {
      return failClosedResult(input, 'CHECKER_EXECUTION_FAILED');
    }
    return JSON.parse(child.stdout);
  } catch {
    return failClosedResult(input, 'CHECKER_FAIL_CLOSED');
  }
}

function spawnC1Child(args, input, timeoutMs = C1_EXECUTION_TIMEOUT_MS) {
  return spawnWithSnapshotInput(process.execPath, [__filename, ...args], {
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    // Windows maps SIGKILL to process termination; classify timeout by ETIMEDOUT below.
    killSignal: 'SIGKILL',
    maxBuffer: C1_EXECUTION_MAX_BUFFER_BYTES
  });
}

function failClosedResult(input, code) {
  const method = input && input.method ? input.method : 'isolation';
  const selected = input && input.policy && input.policy.distributions
    && input.policy.distributions[input.distribution];
  const missing = [...COVERAGE_IDS];
  if (method === 'ast') missing.push('ast-structure');
  return {
    method,
    coverage: { complete: false, checked: [], missing },
    diagnostics: [{
      code,
      file: selected && typeof selected.evaluator === 'string' ? selected.evaluator : '<input>',
      location: 'checkBoundary',
      ruleId: code
    }]
  };
}

function runBoundaryCheck({ distribution, sources, policy, method = 'isolation' } = {}) {
  if (method === 'ast') return runAstBoundaryCheck({ distribution, sources, policy });

  const diagnostics = [];
  const checked = [];
  const missing = [];
  const selected = policy && policy.distributions && policy.distributions[distribution];

  const add = (code, file, location, ruleId, exceptionId) => {
    diagnostics.push({
      code,
      file: typeof file === 'string' ? file : '<policy>',
      location: typeof location === 'string' ? location : 'input',
      ruleId,
      ...(exceptionId ? { exceptionId } : {})
    });
  };
  const mark = id => {
    if (!checked.includes(id)) checked.push(id);
  };

  if (!policy || policy.schemaVersion !== 1 || !Array.isArray(policy.coverage)
    || !Array.isArray(policy.compatibilityLedger)) {
    add('POLICY_INVALID', '<policy>', 'schemaVersion', 'POLICY_SCHEMA');
    missing.push(...COVERAGE_IDS);
    return { method: method || 'isolation', coverage: { complete: false, checked, missing }, diagnostics };
  }
  if (method !== 'isolation') {
    add('METHOD_UNSUPPORTED', '<policy>', String(method), 'METHOD_SUPPORTED');
    missing.push(...COVERAGE_IDS);
    return { method: method || 'isolation', coverage: { complete: false, checked, missing }, diagnostics };
  }
  if (!selected || !sources || typeof sources.evaluator !== 'string' || !sources.evaluator
    || typeof sources.capture !== 'string' || !sources.capture) {
    add('SOURCE_PAIR_MISSING', selected ? selected.evaluator : '<policy>', 'source-pair', 'SOURCE_PAIR_COMPLETE');
    missing.push('source-pair', 'module-exports', 'evaluator-context-surface',
      'invocation-capabilities', 'obligation-capabilities', 'capture-return-schemas',
      'returned-view-ownership', 'capture-call-sites', 'compatibility-ledger');
    return { method, coverage: { complete: false, checked, missing }, diagnostics };
  }
  mark('source-pair');

  const fileFor = kind => selected[kind];
  const sourceByKind = { evaluator: sources.evaluator, capture: sources.capture };
  const policyProblems = validatePolicy(policy);
  if (policyProblems.length) {
    for (const problem of policyProblems) {
      add('POLICY_INVALID', '<policy>', problem.location, 'POLICY_SCHEMA');
    }
    return {
      method,
      coverage: { complete: false, checked, missing: [...COVERAGE_IDS] },
      diagnostics
    };
  }

  let runtime;
  try {
    runtime = compilePair(sources, selected, policy, add);
  } catch (error) {
    add('MODULE_LOAD_FAILED', fileFor('evaluator'), 'module-load', 'MODULE_LOADABLE');
    missing.push('module-exports', 'invocation-capabilities', 'obligation-capabilities',
      'capture-return-schemas', 'returned-view-ownership');
  }

  if (runtime) {
    const exportChecks = [
      ['evaluator', runtime.evaluator, policy.modules.evaluatorExports],
      ['capture', runtime.capture, policy.modules.captureExports]
    ];
    for (const [kind, exportsObject, expected] of exportChecks) {
      const actual = Reflect.ownKeys(exportsObject);
      const expectedPrototype = vm.runInContext('Object.prototype', runtime.context);
      if (!sameStringSet(actual, expected) || Object.getPrototypeOf(exportsObject) !== expectedPrototype
        || !hasOwnFunctionDataProperties(exportsObject, expected)) {
        add('MODULE_EXPORT_SURFACE', fileFor(kind), 'module.exports', 'MODULE_EXPORTS_EXACT');
      }
    }
    mark('module-exports');

    checkRequireSurface(sourceByKind, fileFor, policy, add);

    const contextOk = checkContextSurface(sources.evaluator, policy.evaluatorContext, fileFor('evaluator'), add);
    if (contextOk) mark('evaluator-context-surface');
    else missing.push('evaluator-context-surface');

    const invocationOk = checkCapabilities(runtime, policy, 'invocation', fileFor('capture'), add);
    if (invocationOk) mark('invocation-capabilities');
    else missing.push('invocation-capabilities');

    const obligationOk = checkCapabilities(runtime, policy, 'obligation', fileFor('capture'), add);
    if (obligationOk) mark('obligation-capabilities');
    else missing.push('obligation-capabilities');

    const viewResults = exerciseSyntheticViews(runtime, policy, fileFor('capture'), add);
    if (viewResults.schemasComplete) mark('capture-return-schemas');
    else missing.push('capture-return-schemas');
    if (viewResults.ownershipComplete) mark('returned-view-ownership');
    else missing.push('returned-view-ownership');

    const evaluatorOk = exerciseSyntheticEvaluator(runtime, add, fileFor('evaluator'));
    if (!evaluatorOk) missing.push('evaluator-context-surface');
  } else {
    for (const id of ['module-exports', 'evaluator-context-surface', 'invocation-capabilities',
      'obligation-capabilities', 'capture-return-schemas', 'returned-view-ownership']) {
      if (!missing.includes(id)) missing.push(id);
    }
  }

  const callSitesOk = checkCallSites(sources.evaluator, policy.callSites, fileFor('evaluator'), add);
  if (callSitesOk) mark('capture-call-sites');
  else missing.push('capture-call-sites');

  const ledgerOk = checkCompatibilityLedger(sourceByKind, policy.compatibilityLedger, fileFor, add);
  if (ledgerOk) mark('compatibility-ledger');
  else missing.push('compatibility-ledger');

  for (const id of policy.coverage) {
    if (!COVERAGE_IDS.includes(id)) {
      add('POLICY_COVERAGE_UNKNOWN', '<policy>', id, 'POLICY_COVERAGE_DECLARED');
    }
  }
  for (const id of COVERAGE_IDS) {
    if (!policy.coverage.includes(id) || !checked.includes(id)) {
      if (!missing.includes(id)) missing.push(id);
    }
  }

  return {
    method,
    coverage: { complete: missing.length === 0, checked, missing: unique(missing) },
    diagnostics
  };
}

function runAstBoundaryCheck({ distribution, sources, policy } = {}) {
  const diagnostics = [];
  const checked = [];
  const missing = [];
  const selected = policy && policy.distributions && policy.distributions[distribution];
  const add = (code, file, location, ruleId, exceptionId) => {
    appendDiagnostic(diagnostics, code, file, location, ruleId, exceptionId);
  };

  if (!selected || !sources || typeof sources.evaluator !== 'string' || !sources.evaluator
    || typeof sources.capture !== 'string' || !sources.capture) {
    add('SOURCE_PAIR_MISSING', selected ? selected.evaluator : '<policy>', 'source-pair', 'SOURCE_PAIR_COMPLETE');
    return { method: 'ast', coverage: { complete: false, checked, missing: ['source-pair', 'ast-structure'] }, diagnostics };
  }
  checked.push('source-pair');

  const astPolicy = policy && policy.astSupplement;
  const policyProblems = validateAstPolicy(astPolicy);
  if (policyProblems.length) {
    for (const location of policyProblems) add('AST_POLICY_INVALID', '<policy>', location, 'AST_POLICY_COMPLETE');
    missing.push('ast-structure');
    return { method: 'ast', coverage: { complete: false, checked, missing }, diagnostics };
  }

  let parser;
  try {
    parser = loadAstParser(astPolicy.parser);
  } catch {
    add('AST_PARSER_UNAVAILABLE', '<policy>', 'parser', 'AST_PARSER_PINNED');
    missing.push('ast-structure');
    return { method: 'ast', coverage: { complete: false, checked, missing }, diagnostics };
  }

  const trees = {};
  for (const kind of ['evaluator', 'capture']) {
    try {
      const ast = parser.acorn.parse(sources[kind], {
        ecmaVersion: 'latest',
        sourceType: 'commonjs',
        allowHashBang: true
      });
      const nodeTypes = new Set();
      parser.walk.full(ast, node => nodeTypes.add(node.type));
      trees[kind] = ast;
    } catch (error) {
      const code = error && error.name === 'SyntaxError' ? 'AST_PARSE_FAILED' : 'AST_NODE_UNSUPPORTED';
      const ruleId = code === 'AST_PARSE_FAILED' ? 'AST_PARSE_COMPLETE' : 'AST_SUPPORTED_NODE_SET';
      add(code, selected[kind], error && error.message ? error.message : 'parse-or-walk', ruleId);
      missing.push('ast-structure');
    }
  }
  if (missing.includes('ast-structure')) {
    return { method: 'ast', coverage: { complete: false, checked, missing: ['ast-structure'] }, diagnostics };
  }

  for (const kind of ['evaluator', 'capture']) {
    const actual = astFingerprint(trees[kind], parser.walk);
    if (actual !== astPolicy.moduleFingerprints[kind]) {
      add('AST_PROGRAM_DRIFT', selected[kind], '@program', 'AST_SOURCE_STRUCTURE', `AST-${kind.toUpperCase()}`);
    }
  }

  let targetsComplete = true;
  for (const target of astPolicy.targets) {
    const candidates = findAstTarget(trees[target.module], target.name, parser.walk);
    if (candidates.length !== 1) {
      add('AST_TARGET_INCOMPLETE', selected[target.module], target.name, 'AST_TARGETS_COMPLETE', target.exceptionId);
      targetsComplete = false;
      continue;
    }
    const actual = astFingerprint(candidates[0], parser.walk, trees[target.module]);
    if (actual !== target.fingerprint) {
      for (const ruleId of target.ruleIds) {
        add('AST_TARGET_DRIFT', selected[target.module], target.name, ruleId, target.exceptionId);
      }
    }
  }
  if (targetsComplete) checked.push('ast-structure');
  else missing.push('ast-structure');
  return {
    method: 'ast',
    coverage: { complete: missing.length === 0, checked, missing },
    diagnostics
  };
}

function loadAstParser(expected) {
  const acorn = require('acorn');
  const walk = require('acorn-walk');
  const acornVersion = require('acorn/package.json').version;
  const walkVersion = require('acorn-walk/package.json').version;
  if (acornVersion !== expected.acorn || walkVersion !== expected.acornWalk) {
    throw new Error('installed parser version does not match the reviewed policy');
  }
  return { acorn, walk };
}

function appendDiagnostic(diagnostics, code, file, location, ruleId, exceptionId) {
  diagnostics.push({
    code,
    file: typeof file === 'string' ? file : '<policy>',
    location: typeof location === 'string' ? location : 'input',
    ruleId,
    ...(exceptionId ? { exceptionId } : {})
  });
}

function validateAstPolicy(policy) {
  const problems = [];
  if (!policy || policy.schemaVersion !== 1 || policy.status !== 'frozen-for-c2'
    || !policy.parser || typeof policy.parser.acorn !== 'string'
    || typeof policy.parser.acornWalk !== 'string'
    || policy.canonicalization !== 'estree-alpha-target-v2'
    || !policy.moduleFingerprints || !isSha256(policy.moduleFingerprints.evaluator)
    || !isSha256(policy.moduleFingerprints.capture) || !Array.isArray(policy.targets)
    || policy.targets.length === 0) {
    problems.push('astSupplement schema/status/parser/fingerprints/targets');
    return problems;
  }
  const keys = new Set();
  for (const target of policy.targets) {
    const key = target && `${target.module}:${target.name}`;
    if (!target || !['evaluator', 'capture'].includes(target.module)
      || typeof target.name !== 'string' || !target.name
      || !Array.isArray(target.ruleIds) || !target.ruleIds.length
      || target.ruleIds.some(ruleId => typeof ruleId !== 'string' || !ruleId)
      || !isSha256(target.fingerprint) || (target.exceptionId !== undefined && typeof target.exceptionId !== 'string')
      || keys.has(key)) {
      problems.push(`astSupplement target ${key || '<unknown>'}`);
    }
    keys.add(key);
  }
  return problems;
}

function collectUniqueLocalNames(ast, walk) {
  const counts = new Map();
  const declarationOrder = [];
  const addPattern = pattern => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      counts.set(pattern.name, (counts.get(pattern.name) || 0) + 1);
      if (!declarationOrder.includes(pattern.name)) declarationOrder.push(pattern.name);
    } else if (pattern.type === 'RestElement') addPattern(pattern.argument);
    else if (pattern.type === 'AssignmentPattern') addPattern(pattern.left);
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(addPattern);
    else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) addPattern(property.type === 'RestElement' ? property.argument : property.value);
    }
  };
  walk.full(ast, node => {
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    else if (['FunctionDeclaration', 'FunctionExpression'].includes(node.type)) {
      if (node.id) addPattern(node.id);
      node.params.forEach(addPattern);
    } else if (node.type === 'ArrowFunctionExpression') node.params.forEach(addPattern);
    else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) addPattern(node.id);
    } else if (node.type === 'CatchClause' && node.param) addPattern(node.param);
    else if (node.type === 'ImportDeclaration') {
      node.specifiers.forEach(specifier => addPattern(specifier.local));
    }
  });
  const uniqueNames = new Map();
  let index = 0;
  for (const name of declarationOrder) {
    if (counts.get(name) === 1) uniqueNames.set(name, `local-${index++}`);
  }
  return uniqueNames;
}

function astFingerprint(node, walk, moduleAst) {
  const localNames = moduleAst
    ? collectTargetLocalNames(node, moduleAst, walk)
    : collectUniqueLocalNames(node, walk);
  const canonical = canonicalAstNode(node, localNames, null, null);
  return require('node:crypto').createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function collectTargetLocalNames(node, moduleAst, walk) {
  const moduleUniqueNames = collectUniqueLocalNames(moduleAst, walk);
  const localNames = new Map();
  const visit = (current, parent, key) => {
    if (Array.isArray(current)) {
      current.forEach(item => visit(item, parent, key));
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (current.type === 'Identifier') {
      if (!isStaticIdentifierName(parent, key) && moduleUniqueNames.has(current.name)
        && !localNames.has(current.name)) {
        localNames.set(current.name, `local-${localNames.size}`);
      }
      return;
    }
    for (const childKey of Object.keys(current).sort()) {
      if (childKey === 'start' || childKey === 'end' || childKey === 'loc'
        || (childKey === 'raw' && current.type === 'Literal')) continue;
      visit(current[childKey], current, childKey);
    }
  };
  visit(node, null, null);
  return localNames;
}

function canonicalAstNode(node, localNames, parent, key) {
  if (Array.isArray(node)) return node.map(item => canonicalAstNode(item, localNames, parent, key));
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'Identifier') {
    if (isStaticIdentifierName(parent, key)) return { type: 'Identifier', name: node.name };
    return { type: 'Identifier', name: localNames.has(node.name) ? `$${localNames.get(node.name)}` : node.name };
  }
  const result = {};
  for (const childKey of Object.keys(node).sort()) {
    if (childKey === 'start' || childKey === 'end' || childKey === 'loc'
      || (childKey === 'raw' && node.type === 'Literal')) continue;
    result[childKey] = canonicalAstNode(node[childKey], localNames, node, childKey);
  }
  return result;
}

function isStaticIdentifierName(parent, key) {
  if (!parent) return false;
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
  if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
    && key === 'key' && !parent.computed) return true;
  if (parent.type === 'LabeledStatement' && key === 'label') return true;
  if ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label') return true;
  if (parent.type === 'MetaProperty') return true;
  if (parent.type === 'ImportSpecifier' && key === 'imported') return true;
  if ((parent.type === 'ExportSpecifier' || parent.type === 'ExportDefaultSpecifier') && key === 'exported') return true;
  return false;
}

function findAstTarget(ast, name, walk) {
  if (name === '@program') return [ast];
  if (name === '@evaluateObligation-context-destructure') {
    const evaluators = findAstTarget(ast, 'evaluateObligation', walk);
    if (evaluators.length !== 1) return [];
    const destructures = [];
    walk.full(evaluators[0], node => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern'
        && node.init && node.init.type === 'Identifier' && node.init.name === 'context') {
        destructures.push(node);
      }
    });
    return destructures;
  }
  const matches = [];
  walk.full(ast, node => {
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === name) matches.push(node);
    else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
      && node.id.name === name && node.init
      && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init.type)) matches.push(node.init);
    else if (node.type === 'Property' && node.value
      && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.value.type)
      && !node.computed && ((node.key.type === 'Identifier' && node.key.name === name)
        || (node.key.type === 'Literal' && node.key.value === name))) matches.push(node.value);
    if (name === '@exports' && node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression'
      && !node.left.computed && node.left.object.type === 'Identifier' && node.left.object.name === 'module'
      && node.left.property.type === 'Identifier' && node.left.property.name === 'exports') matches.push(node);
  });
  return matches;
}

function compilePair(sources, selected, policy, add) {
  const context = vm.createContext(Object.create(null), {
    name: 'doc-evidence-boundary-isolation',
    codeGeneration: { strings: false, wasm: false }
  });
  const allowedBuiltins = new Set(policy.modules.captureBuiltins || []);
  // Keep the only needed host capability behind VM-realm methods. The captured host function
  // receives and returns primitives only; capture source cannot reach its Function constructor.
  const makeCryptoFacade = vm.runInContext(
    '(digestText) => Object.freeze({ createHash(algorithm) {' +
    ' if (algorithm !== "sha256") throw new Error("unsupported hash algorithm");' +
    ' let text = "";' +
    ' const hash = {' +
    ' update(value) {' +
    ' if (typeof value !== "string") throw new TypeError("hash input must be a string");' +
    ' text += value;' +
    ' return hash;' +
    ' },' +
    ' digest(encoding) {' +
    ' if (encoding !== "hex") throw new TypeError("hash encoding must be hex");' +
    ' return digestText(text);' +
    ' }' +
    ' };' +
    ' return Object.freeze(hash);' +
    '} })',
    context,
    { timeout: 1000 }
  );
  const hostDigest = Object.freeze(text =>
    require('node:crypto').createHash('sha256').update(text).digest('hex'));
  const cryptoFacade = makeCryptoFacade(hostDigest);
  const makeImportMap = vm.runInContext(
    '(specifier, value) => {' +
    ' const imports = Object.create(null);' +
    ' if (typeof specifier === "string") imports[specifier] = value;' +
    ' return Object.freeze(imports);' +
    ' }',
    context,
    { timeout: 1000 }
  );
  const makeRequireFacade = vm.runInContext(
    '(allowed, reportDenied) => function requireInRealm(specifier) {' +
    ' if (typeof specifier === "string" && Object.prototype.hasOwnProperty.call(allowed, specifier)) {' +
    ' return allowed[specifier];' +
    ' }' +
    ' const label = typeof specifier === "string" ? specifier : "<non-string>";' +
    ' reportDenied(label);' +
    ' throw new Error("unsupported import: " + label);' +
    ' }',
    context,
    { timeout: 1000 }
  );
  const deniedImportReporter = file => Object.freeze(specifier => {
    add('MODULE_IMPORT_DENIED', file, `require(${specifier})`, 'MODULE_IMPORTS_CLOSED');
  });
  let captureModule;
  const loaded = { evaluator: null, capture: null };
  const compile = (kind, source, localRequire) => {
    const moduleRecord = vm.runInContext('({ exports: {} })', context);
    const prefix = `__boundary_${kind}`;
    context[`${prefix}_module`] = moduleRecord;
    context[`${prefix}_require`] = localRequire;
    context[`${prefix}_filename`] = selected[kind];
    context[`${prefix}_dirname`] = selected[kind].split('/').slice(0, -1).join('/');
    context[`${prefix}_wrapper`] = vm.runInContext(
      `(function(exports, require, module, __filename, __dirname) {\n${source}\n})`,
      context,
      { filename: selected[kind], timeout: 1000 }
    );
    try {
      vm.runInContext(
        `${prefix}_wrapper(${prefix}_module.exports, ${prefix}_require, ${prefix}_module, ${prefix}_filename, ${prefix}_dirname)`,
        context,
        { filename: selected[kind], timeout: 1000 }
      );
    } finally {
      delete context[`${prefix}_module`];
      delete context[`${prefix}_require`];
      delete context[`${prefix}_filename`];
      delete context[`${prefix}_dirname`];
      delete context[`${prefix}_wrapper`];
    }
    return moduleRecord.exports;
  };

  const captureImports = makeImportMap(allowedBuiltins.has('crypto') ? 'crypto' : null, cryptoFacade);
  const captureRequire = makeRequireFacade(captureImports, deniedImportReporter(selected.capture));
  captureModule = compile('capture', sources.capture, captureRequire);
  loaded.capture = captureModule;
  const evaluatorImports = makeImportMap('./doc-evidence-capture', captureModule);
  const evaluatorRequire = makeRequireFacade(evaluatorImports, deniedImportReporter(selected.evaluator));
  loaded.evaluator = compile('evaluator', sources.evaluator, evaluatorRequire);
  loaded.context = context;
  return loaded;
}

function checkRequireSurface(sourceByKind, fileFor, policy, add) {
  let ok = true;
  for (const kind of ['evaluator', 'capture']) {
    const source = sourceByKind[kind];
    const literal = [];
    const pattern = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
    let match;
    while ((match = pattern.exec(source))) literal.push(match[2]);
    const allCalls = (source.match(/\brequire\s*(?:\?\.)?\s*\(/g) || []).length;
    const requireReferences = (source.match(/\brequire\b/g) || []).length;
    const alternateImport = /\bmodule\s*(?:\.\s*require|\[\s*['"]require['"]\s*\])\s*\(/.test(source)
      || /\bimport\s*(?:\?\.)?\s*\(/.test(source);
    const expected = policy.modules[`${kind}Requires`];
    if (!sameStringArray(literal.sort(), [...expected].sort()) || allCalls !== literal.length
      || requireReferences !== allCalls || alternateImport) {
      add('MODULE_IMPORT_SURFACE', fileFor(kind), 'require', 'MODULE_IMPORTS_CLOSED');
      ok = false;
    }
  }
  return ok;
}

function checkContextSurface(source, contextPolicy, file, add) {
  const call = /evaluateObligation\s*\(\s*obligation\s*,\s*\{\s*([^{}]*?)\s*\}\s*\)/gs;
  const calls = [...source.matchAll(call)];
  let ok = calls.length === 1;
  if (calls.length !== 1) {
    add('CONTEXT_HANDOFF_SHAPE', file, 'evaluateObligation', 'EVALUATOR_CONTEXT_EXACT');
  } else {
    const handoff = parseShorthandSurface(calls[0][1]);
    if (!handoff || !sameStringArray(handoff, contextPolicy.handoffKeys)) {
      add('CONTEXT_HANDOFF_SURFACE', file, 'evaluateObligation(context)', 'EVALUATOR_CONTEXT_EXACT');
      ok = false;
    }
  }
  const destructure = /function\s+evaluateObligation\s*\(\s*obligation\s*,\s*context\s*\)\s*\{[\s\S]{0,500}?const\s*\{\s*([^{}]+?)\s*\}\s*=\s*context\s*;/g;
  const destructures = [...source.matchAll(destructure)];
  if (destructures.length !== 1) {
    add('CONTEXT_CONSUMER_SHAPE', file, 'evaluateObligation(context)', 'EVALUATOR_CONTEXT_EXACT');
    ok = false;
  } else {
    const keys = parseShorthandSurface(destructures[0][1]);
    if (!keys || !sameStringArray(keys, contextPolicy.consumerKeys)) {
      add('CONTEXT_CONSUMER_SURFACE', file, 'evaluateObligation(context)', 'EVALUATOR_CONTEXT_EXACT');
      ok = false;
    }
  }
  const contextPropertyUses = (source.match(/\bcontext\s*\./g) || []).length;
  const contextTokens = (source.match(/\bcontext\b/g) || []).length;
  if (contextPropertyUses !== 0 || contextTokens !== 2) {
    add('CONTEXT_ALIAS_OR_COMPUTED_USE', file, 'context', 'EVALUATOR_CONTEXT_EXACT');
    ok = false;
  }
  return ok;
}

function parseShorthandSurface(text) {
  const normalized = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
  if (!normalized) return [];
  const parts = normalized.split(',').map(part => part.trim());
  if (parts.some(part => !/^[A-Za-z_$][\w$]*$/.test(part))) return null;
  return parts;
}

function checkCapabilities(runtime, policy, scope, file, add) {
  try {
    const expected = policy.capabilities[scope];
    const object = scope === 'invocation'
      ? runtime.capture.createInvocationCapture(makeSyntheticInvocation(runtime.context))
      : runtime.capture.createInvocationCapture(makeSyntheticInvocation(runtime.context)).beginObligation('applicable');
    const actual = Reflect.ownKeys(object);
    const expectedPrototype = vm.runInContext('Object.prototype', runtime.context);
    const exact = sameStringSet(actual, expected) && Object.isFrozen(object)
      && Object.getPrototypeOf(object) === expectedPrototype
      && hasOwnFunctionDataProperties(object, expected);
    if (!exact) add('CAPABILITY_SURFACE', file, scope, scope === 'invocation'
      ? 'INVOCATION_CAPABILITIES_EXACT' : 'OBLIGATION_CAPABILITIES_EXACT');
    return exact;
  } catch {
    add('CAPABILITY_SURFACE_UNREADABLE', file, scope, scope === 'invocation'
      ? 'INVOCATION_CAPABILITIES_EXACT' : 'OBLIGATION_CAPABILITIES_EXACT');
    return false;
  }
}

function hasOwnFunctionDataProperties(object, expected) {
  return expected.every(name => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    return Boolean(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      && typeof descriptor.value === 'function');
  });
}

function makeSyntheticInvocation(context) {
  return vm.runInContext(`({
    artifacts: { 'docs/prd/one.md': { digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
    baseline: { digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', artifacts: {} }
  })`, context, { timeout: 1000 });
}

function exerciseSyntheticViews(runtime, policy, file, add) {
  let schemasComplete = true;
  let ownershipComplete = true;
  const context = runtime.context;
  const samples = [];
  try {
    const fixture = vm.runInContext(`(() => {
    const fixture = {
      artifacts: {
        'docs/ordinary.md': { digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
        'docs/destination.md': { digest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' },
        'docs/prd/spec.md': { digest: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }
      },
      baseline: {
        digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        artifacts: { 'docs/base.md': 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }
      },
      nested: { marker: 'caller-owned' },
      rawEntry: null
    };
    fixture.rawEntry = { path: 'docs/base.md', reason: 'added', renameTo: 'docs/destination.md', nested: fixture.nested };
    return fixture;
  })()`, context, { timeout: 1000 });
    const defineSyntheticFault = vm.runInContext(
      `(target, key) => Object.defineProperty(target, key, { get() { throw new Error('synthetic read fault'); } })`,
      context,
      { timeout: 1000 }
    );
    const defineSyntheticUndefined = vm.runInContext(
      `(target, key) => Object.defineProperty(target, key, { value: undefined, enumerable: true })`,
      context,
      { timeout: 1000 }
    );
    const inputs = collectObjectGraph([fixture]);
    const invocationArgs = vm.runInContext('({ artifacts: null, baseline: null })', context);
    invocationArgs.artifacts = fixture.artifacts;
    invocationArgs.baseline = fixture.baseline;
    const invocation = runtime.capture.createInvocationCapture(invocationArgs);
    invocation.initializeArtifactFallback();
    const baselineDigest = invocation.captureBaselineIdentity();
    addSample('captureBaselineIdentity', baselineDigest, 'string');
    addSample('candidateInventoryKnown', invocation.candidateInventoryKnown(), 'boolean');
    const obligation = invocation.beginObligation('applicable');
    addSample('prepareBaselineContainer', obligation.prepareBaselineContainer(), 'boolean');

    const captured = obligation.captureEntry(fixture.rawEntry);
    const entrySample = addSample('captureEntry', captured, 'captureEntry');
    const sourceAbsence = obligation.captureSourceAbsence(captured.token, 'docs/base.md');
    addSample('captureSourceAbsence', sourceAbsence, 'captureSourceAbsence');
    addSample('captureSourceAbsence.present', obligation.captureSourceAbsence(captured.token, 'docs/ordinary.md'), 'captureSourceAbsence');
    const capturedAgain = obligation.captureEntry(fixture.rawEntry);
    if (capturedAgain === captured || capturedAgain.token === captured.token) {
      ownershipComplete = false;
      add('RETURNED_VIEW_REUSE', file, 'captureEntry', 'RETURNED_VIEW_OWNERSHIP');
    }
    addSample('captureEntry.repeated', capturedAgain, 'captureEntry');
    addSample('captureEntry.notObject', obligation.captureEntry(null), 'captureEntry');
    const rawWithoutRename = vm.runInContext("({ path: 'docs/plain.md', reason: 'added' })", context);
    inputs.add(rawWithoutRename);
    addSample('captureEntry.noRenameTo', obligation.captureEntry(rawWithoutRename), 'captureEntry');
    const failedEntry = vm.runInContext(`(() => {
      const entry = {};
      Object.defineProperty(entry, 'path', { get() { throw new Error('synthetic read fault'); } });
      return entry;
    })()`, context);
    inputs.add(failedEntry);
    addSample('captureEntry.inspectionFailed', obligation.captureEntry(failedEntry), 'captureEntry');
    addSample('formatInvalidReason', obligation.formatInvalidReason(captured.token), 'string');
    addSample('formatInvalidRenameTo', obligation.formatInvalidRenameTo(captured.token), 'string');

    const acceptedDestination = obligation.captureDestination(captured.token, 'docs/destination.md');
    addSample('captureDestination.accepted', acceptedDestination, 'captureDestination');
    addSample('captureDestination.unusable', obligation.captureDestination(captured.token, 'docs/missing.md'), 'captureDestination');
    fixture.artifacts['docs/destination.md'].digest = '9999999999999999999999999999999999999999999999999999999999999999';
    addSample('captureDestination.conflict', obligation.captureDestination(captured.token, 'docs/destination.md'), 'captureDestination');
    defineSyntheticFault(fixture.artifacts, 'docs/fault.md');
    addSample('captureDestination.inspectionFailed', obligation.captureDestination(captured.token, 'docs/fault.md'), 'captureDestination');

    addSample('captureBaselinePath.present', obligation.captureBaselinePath('docs/base.md'), 'captureBaselinePath');
    addSample('captureBaselinePath.absent', obligation.captureBaselinePath('docs/missing.md'), 'captureBaselinePath');
    defineSyntheticUndefined(fixture.baseline.artifacts, 'docs/undefined.md');
    fixture.baseline.artifacts['docs/invalid.md'] = 42;
    addSample('captureBaselinePath.presentUndefined', obligation.captureBaselinePath('docs/undefined.md'), 'captureBaselinePath');
    addSample('captureBaselinePath.presentInvalid', obligation.captureBaselinePath('docs/invalid.md'), 'captureBaselinePath');
    defineSyntheticFault(fixture.baseline.artifacts, 'docs/fault.md');
    addSample('captureBaselinePath.unknown', obligation.captureBaselinePath('docs/fault.md'), 'captureBaselinePath');

    addSample('baselineEntries.empty', obligation.baselineEntries(), 'baselineEntries');
    addSample('baselineAuditPairs.empty', obligation.baselineAuditPairs(), 'baselineAuditPairs');

    obligation.poisonDestination('docs/poisoned.md');
    addSample('isDestinationPoisoned', obligation.isDestinationPoisoned('docs/poisoned.md'), 'boolean');
    addSample('captureOrdinaryCandidates', obligation.captureOrdinaryCandidates(vm.runInContext("['docs/ordinary.md']", context)), 'boolean');
    addSample('capturedCandidate.captured', obligation.capturedCandidate('docs/ordinary.md'), 'capturedCandidate');
    addSample('capturedCandidate.uncaptured', obligation.capturedCandidate('docs/not-captured.md'), 'capturedCandidate');
    addSample('candidateAuditValue', obligation.candidateAuditValue('docs/ordinary.md'), 'string');

    const acceptedBaselineEntry = vm.runInContext(
      '({ entryToken: null, path: null, reason: null, trustedBaselineDigest: null })', context);
    acceptedBaselineEntry.entryToken = captured.token;
    acceptedBaselineEntry.path = 'docs/base.md';
    acceptedBaselineEntry.reason = 'added';
    acceptedBaselineEntry.trustedBaselineDigest = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    obligation.acceptBaselineEntry(acceptedBaselineEntry);
    const renameRawEntry = vm.runInContext(
      "({ path: 'docs/renamed.md', reason: 'rename-from', renameTo: 'docs/destination.md' })", context);
    inputs.add(renameRawEntry);
    const renameCapture = obligation.captureEntry(renameRawEntry);
    obligation.captureSourceAbsence(renameCapture.token, 'docs/renamed.md');
    const acceptedRenameEntry = vm.runInContext(
      `({ entryToken: null, path: null, reason: null, renameTo: null,
        renameDestinationDigest: null, trustedBaselineDigest: null })`, context);
    acceptedRenameEntry.entryToken = renameCapture.token;
    acceptedRenameEntry.path = 'docs/renamed.md';
    acceptedRenameEntry.reason = 'rename-from';
    acceptedRenameEntry.renameTo = 'docs/destination.md';
    acceptedRenameEntry.renameDestinationDigest = acceptedDestination.digest;
    acceptedRenameEntry.trustedBaselineDigest = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    obligation.acceptBaselineEntry(acceptedRenameEntry);
    const baselineEntries = obligation.baselineEntries();
    addSample('baselineEntries', baselineEntries, 'baselineEntries');
    const entryCopyA = obligation.baselineEntries();
    const entryCopyB = obligation.baselineEntries();
    entryCopyA.push(vm.runInContext("({ path: 'docs/injected.md' })", context));
    const entryCopyC = obligation.baselineEntries();
    if (entryCopyA === entryCopyB || entryCopyB.length !== entryCopyC.length
      || someArrayValue(entryCopyB, (entry, index) => entry === entryCopyC[index])) {
      ownershipComplete = false;
      add('RETURNED_ARRAY_REUSE', file, 'baselineEntries', 'RETURNED_VIEW_OWNERSHIP');
    }
    const baselinePairs = obligation.baselineAuditPairs();
    addSample('baselineAuditPairs', baselinePairs, 'baselineAuditPairs');
    const pairCopyA = obligation.baselineAuditPairs();
    const pairCopyB = obligation.baselineAuditPairs();
    pairCopyA.push(vm.runInContext("['docs/injected.md', '0000000000000000000000000000000000000000000000000000000000000000']", context));
    const pairCopyC = obligation.baselineAuditPairs();
    if (pairCopyA === pairCopyB || pairCopyB.length !== pairCopyC.length
      || someArrayValue(pairCopyB, (pair, index) => pair === pairCopyC[index])) {
      ownershipComplete = false;
      add('RETURNED_ARRAY_REUSE', file, 'baselineAuditPairs', 'RETURNED_VIEW_OWNERSHIP');
    }
    const compatibilityCandidate = vm.runInContext(
      '({ baseDigest: null, artifactDigests: {}, paths: [] })', context);
    compatibilityCandidate.baseDigest = baselineDigest;
    compatibilityCandidate.artifactDigests['docs/ordinary.md'] = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    compatibilityCandidate.paths.push('docs/ordinary.md');
    addSample('compatibilityCandidateBound', obligation.compatibilityCandidateBound(
      compatibilityCandidate, 'docs/ordinary.md', baselineDigest), 'boolean');
    const staleArtifact = vm.runInContext('({ artifactDigests: {} })', context);
    staleArtifact.artifactDigests['docs/ordinary.md'] = '0000000000000000000000000000000000000000000000000000000000000000';
    addSample('compatibilityStaleArtifactMismatch', obligation.compatibilityStaleArtifactMismatch(
      staleArtifact, 'docs/ordinary.md'), 'boolean');
    addSample('compatibilityPrdSetDigest', invocation.compatibilityPrdSetDigest(), 'sha256');

    for (const sample of samples) {
      if (!validateSchema(sample.value, sample.schema, policy.returnSchemas, context)) {
        schemasComplete = false;
        add('RETURN_SCHEMA_MISMATCH', file, sample.name, 'CAPTURE_RETURN_SCHEMAS');
      }
      if (!validateOwnedGraph(sample.value, inputs, context)) {
        ownershipComplete = false;
        add('RETURNED_VIEW_ESCAPE', file, sample.name, 'RETURNED_VIEW_OWNERSHIP');
      }
    }
    if (!entrySample) schemasComplete = false;
  } catch (error) {
    schemasComplete = false;
    ownershipComplete = false;
    add('SYNTHETIC_VIEW_EXERCISE_FAILED', file, 'synthetic-capture-graph', 'CAPTURE_SYNTHETIC_GRAPH');
  }
  return { schemasComplete, ownershipComplete };

  function addSample(name, value, schema) {
    // A missing policy schema must fail validation, never turn this sample into an opt-out.
    samples.push({ name, value, schema });
    return true;
  }
}

function validateSchema(value, schemaName, schemas, context) {
  const schema = schemas[schemaName];
  if (!schema) return false;
  if (schema.kind === 'primitive') return primitiveMatches(value, schema.type);
  if (schema.kind === 'tagged') {
    if (!isRecordObject(value, context)) return false;
    const tag = value[schema.tag];
    const variants = schema.variants.filter(item => item.value === tag);
    return variants.some(variant => exactFields(value, variant.fields, context));
  }
  if (schema.kind === 'array') {
    return everyArrayValue(value, item => validateInline(item, schema.item, schemas, context));
  }
  if (schema.kind === 'pair-array') {
    return everyArrayValue(value, pair => Array.isArray(pair) && pair.length === 2
      && primitiveMatches(pair[0], 'string') && primitiveMatches(pair[1], 'string'));
  }
  return false;
}

// These loops stay in the host realm. Calling value.every/some would pass checker callbacks into
// a VM-owned method that untrusted source could override to inspect their host Function constructor.
function everyArrayValue(values, predicate) {
  if (!Array.isArray(values)) return false;
  const length = values.length;
  for (let index = 0; index < length; index++) {
    if (Object.prototype.hasOwnProperty.call(values, index) && !predicate(values[index], index)) return false;
  }
  return true;
}

function someArrayValue(values, predicate) {
  if (!Array.isArray(values)) return false;
  const length = values.length;
  for (let index = 0; index < length; index++) {
    if (Object.prototype.hasOwnProperty.call(values, index) && predicate(values[index], index)) return true;
  }
  return false;
}

function validateInline(value, inline, schemas, context) {
  if (!isRecordObject(value, context) || !exactFields(value, inline, context)) return false;
  return true;
}

function exactFields(value, fields, context) {
  const keys = Reflect.ownKeys(value);
  const required = Object.entries(fields).filter(([, spec]) => !spec.endsWith('?')).map(([key]) => key);
  const allowed = Object.keys(fields);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return false;
  if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) return false;
  for (const [key, originalSpec] of Object.entries(fields)) {
    const optional = originalSpec.endsWith('?');
    const spec = optional ? originalSpec.slice(0, -1) : originalSpec;
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !fieldMatches(descriptor.value, spec, context)) return false;
  }
  return true;
}

function fieldMatches(value, spec, context) {
  if (spec === 'string-or-undefined') return typeof value === 'string' || value === undefined;
  if (spec === 'string') return typeof value === 'string';
  if (spec === 'boolean') return typeof value === 'boolean';
  if (spec === 'undefined') return value === undefined;
  if (spec.startsWith('literal:')) {
    const literal = spec.slice('literal:'.length);
    if (literal === 'true') return value === true;
    if (literal === 'false') return value === false;
    return value === literal;
  }
  if (spec === 'opaque-token') {
    return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === null
      && Reflect.ownKeys(value).length === 0 && Object.isFrozen(value);
  }
  if (spec === 'string-array') return everyArrayValue(value, item => typeof item === 'string');
  return false;
}

function primitiveMatches(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'undefined') return value === undefined;
  if (type === 'sha256') return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  return false;
}

function isRecordObject(value, context) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === vm.runInContext('Object.prototype', context);
}

function validateOwnedGraph(root, inputReferences, context) {
  const seen = new Set();
  const tokenObjects = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 20) return false;
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return true;
    if (inputReferences.has(value) || typeof value === 'function' || seen.has(value)) return false;
    seen.add(value);
    if (Object.getPrototypeOf(value) === null && Object.isFrozen(value) && Reflect.ownKeys(value).length === 0) {
      tokenObjects.add(value);
      return true;
    }
    const expectedPrototype = Array.isArray(value)
      ? vm.runInContext('Array.prototype', context)
      : vm.runInContext('Object.prototype', context);
    if (Object.getPrototypeOf(value) !== expectedPrototype) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || !visit(descriptor.value, depth + 1)) return false;
    }
    return true;
  };
  return visit(root);
}

function collectObjectGraph(roots) {
  const references = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || references.has(value)) return;
    references.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) visit(descriptor.value);
    }
  };
  for (const root of roots) visit(root);
  return references;
}

function exerciseSyntheticEvaluator(runtime, add, file) {
  try {
    const input = vm.runInContext(
      '({ obligations: [], artifacts: {}, baseline: {}, executionRecords: [], reviewRecords: [] })',
      runtime.context,
      { timeout: 1000 }
    );
    const result = runtime.evaluator.checkDocObligations(input);
    if (!result || !Array.isArray(result.diagnostics) || !Array.isArray(result.results)) throw new Error('bad result shape');
    return true;
  } catch (error) {
    add('EVALUATOR_SYNTHETIC_LOAD_FAILED', file, 'checkDocObligations', 'EVALUATOR_SYNTHETIC_CALL');
    return false;
  }
}

function checkCallSites(source, callSites, file, add) {
  // This is an exact inventory of direct dot calls. Alias assignment/argument transfer is not
  // resolved here; such a weakened boundary is a C1 survivor and is reserved for C2 analysis.
  let ok = true;
  const expected = new Map();
  for (const site of callSites) {
    const key = `${site.receiver}.${site.method}`;
    expected.set(key, site.expectedCount);
  }
  const actual = new Map();
  const pattern = /\b(capture|obligationCapture)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const key = `${match[1]}.${match[2]}`;
    actual.set(key, (actual.get(key) || 0) + 1);
  }
  if (/\b(?:capture|obligationCapture)\s*(?:\?\s*\.\s*)?\[/.test(source)) {
    add('CAPTURE_CALL_SITE_COMPUTED', file, 'capture[...]', 'CAPTURE_CALL_SITES');
    ok = false;
  }
  if (/\b(?:capture|obligationCapture)\s*\?\s*\./.test(source)
    || /\b(?:capture|obligationCapture)\s*\.\s*[A-Za-z_$][\w$]*\s*\?\s*\.\s*\(/.test(source)) {
    add('CAPTURE_CALL_SITE_OPTIONAL', file, 'capture?.method()', 'CAPTURE_CALL_SITES');
    ok = false;
  }
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const count = actual.get(key) || 0;
    const expectedCount = expected.get(key);
    const site = callSites.find(item => `${item.receiver}.${item.method}` === key);
    if (expectedCount === undefined || count !== expectedCount) {
      add('CAPTURE_CALL_SITE_DRIFT', file, key, 'CAPTURE_CALL_SITES', site && site.exceptionId);
      ok = false;
    }
  }
  return ok;
}

function checkCompatibilityLedger(sourceByKind, ledger, fileFor, add) {
  const requiredIds = ['COMP-C1', 'COMP-C2-EVAL', 'COMP-C2-BOUND', 'COMP-C3', 'COMP-C4',
    'COMP-C5', 'COMP-CONTAINER', 'COMP-METADATA', 'COMP-REQ'];
  let ok = sameStringSet(ledger.map(item => item.id), requiredIds);
  if (!ok) add('COMPATIBILITY_LEDGER_INCOMPLETE', '<policy>', 'compatibilityLedger', 'COMPATIBILITY_LEDGER_COMPLETE');
  for (const entry of ledger) {
    if (!entry.id || !Array.isArray(entry.sites) || entry.sites.length === 0
      || !Array.isArray(entry.allowed) || !entry.allowed.length
      || !Array.isArray(entry.forbidden) || !entry.forbidden.length) {
      add('COMPATIBILITY_LEDGER_INCOMPLETE', '<policy>', String(entry.id), 'COMPATIBILITY_LEDGER_COMPLETE', entry.id);
      ok = false;
      continue;
    }
    for (const site of entry.sites) {
      const source = sourceByKind[site.module];
      if (!source || typeof site.anchor !== 'string' || !site.anchor
        || countSubstring(source, site.anchor) !== site.expectedCount) {
        add('COMPATIBILITY_ANCHOR_DRIFT', site.module ? fileFor(site.module) : '<policy>',
          site.anchor || String(entry.id), 'COMPATIBILITY_ANCHORS_STABLE', entry.id);
        ok = false;
      }
    }
  }
  return ok;
}

function validatePolicy(policy) {
  const problems = [];
  const requiredSchemas = ['string', 'boolean', 'sha256', 'captureEntry', 'captureSourceAbsence',
    'captureDestination', 'captureBaselinePath', 'capturedCandidate', 'baselineEntries', 'baselineAuditPairs'];
  if (!policy.modules || !Array.isArray(policy.modules.evaluatorExports)
    || !Array.isArray(policy.modules.captureExports)
    || !Array.isArray(policy.modules.evaluatorRequires)
    || !Array.isArray(policy.modules.captureRequires)
    || !Array.isArray(policy.modules.captureBuiltins)
    || !policy.evaluatorContext || !Array.isArray(policy.evaluatorContext.handoffKeys)
    || !Array.isArray(policy.evaluatorContext.consumerKeys)
    || !policy.capabilities || !Array.isArray(policy.capabilities.invocation)
    || !Array.isArray(policy.capabilities.obligation) || !isPlainRecord(policy.returnSchemas)
    || !sameStringSet(Object.keys(policy.returnSchemas), requiredSchemas)
    || !requiredSchemas.every(key => isUsableSchema(policy.returnSchemas[key]))
    || !Array.isArray(policy.callSites) || !Array.isArray(policy.excludedReturnBranches)
    || !policy.ownership || policy.ownership.callerInputIdentityEscapes !== 'forbidden-recursively'
    || policy.ownership.returnedArrays !== 'fresh-detached-arrays'
    || !sameStringArray(policy.ownership.repeatAndMutationProbe, ['baselineEntries', 'baselineAuditPairs'])
    || !Array.isArray(policy.knownC1Limitations) || policy.knownC1Limitations.length < 2) {
    problems.push({ location: 'modules/context/capabilities/returnSchemas/callSites' });
  }
  if (!sameStringSet(policy.coverage, COVERAGE_IDS)) problems.push({ location: 'coverage' });
  for (const [distribution, files] of Object.entries(policy.distributions || {})) {
    if (!['canonical', 'packaged'].includes(distribution) || !files.evaluator || !files.capture) {
      problems.push({ location: `distributions.${distribution}` });
    }
  }
  if (!['canonical', 'packaged'].every(name => policy.distributions && policy.distributions[name])) {
    problems.push({ location: 'distributions must declare canonical and packaged' });
  }
  if (policy.callSites && policy.callSites.some(site => !site || typeof site.receiver !== 'string'
    || typeof site.method !== 'string' || !Number.isInteger(site.expectedCount) || site.expectedCount < 0)) {
    problems.push({ location: 'callSites entry schema' });
  }
  if (policy.compatibilityLedger && policy.compatibilityLedger.some(entry => !entry
    || typeof entry.id !== 'string' || !Array.isArray(entry.sites)
    || !Array.isArray(entry.allowed) || !Array.isArray(entry.forbidden))) {
    problems.push({ location: 'compatibilityLedger entry schema' });
  }
  if (!policy.excludedReturnBranches || policy.excludedReturnBranches.length !== 1
    || policy.excludedReturnBranches[0].api !== 'capturedCandidate'
    || policy.excludedReturnBranches[0].tag !== 'unusable'
    || typeof policy.excludedReturnBranches[0].reason !== 'string') {
    problems.push({ location: 'excludedReturnBranches' });
  }
  if (policy.status !== 'frozen-for-c1') problems.push({ location: 'status must be frozen-for-c1' });
  return problems;
}

function countSubstring(text, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
}

function isUsableSchema(schema) {
  if (!isPlainRecord(schema)) return false;
  if (schema.kind === 'primitive') {
    return ['string', 'boolean', 'undefined', 'sha256'].includes(schema.type);
  }
  if (schema.kind === 'tagged') {
    return typeof schema.tag === 'string' && schema.tag.length > 0
      && Array.isArray(schema.variants) && schema.variants.length > 0
      && schema.variants.every(variant => isPlainRecord(variant)
        && typeof variant.value === 'string' && isPlainRecord(variant.fields)
        && Object.prototype.hasOwnProperty.call(variant.fields, schema.tag)
        && variant.fields[schema.tag] === `literal:${variant.value}`
        && Object.values(variant.fields).every(isUsableFieldSpec));
  }
  if (schema.kind === 'array') {
    return isPlainRecord(schema.item) && Object.keys(schema.item).length > 0
      && Object.values(schema.item).every(isUsableFieldSpec);
  }
  return schema.kind === 'pair-array';
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isUsableFieldSpec(spec) {
  if (typeof spec !== 'string' || !spec) return false;
  if (spec.endsWith('?')) return isUsableFieldSpec(spec.slice(0, -1));
  return ['string', 'boolean', 'undefined', 'string-or-undefined', 'opaque-token', 'string-array']
    .includes(spec) || spec.startsWith('literal:');
}

function sameStringSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && unique(left).length === left.length && unique(right).length === right.length
    && left.every(value => right.includes(value));
}

function sameStringArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module && process.argv[2] === '--c1-test-fast-isolation') {
  // Direct test-only selection: exercise checkBoundary's child path with a short deadline for loop controls.
  let input;
  let result;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
    result = checkIsolationBoundary(input, C1_TEST_EXECUTION_TIMEOUT_MS);
  } catch {
    result = failClosedResult(input, 'CHECKER_FAIL_CLOSED');
  }
  process.stdout.write(JSON.stringify(result));
} else if (require.main === module && process.argv[2] === '--c1-isolation-child') {
  let input;
  let result;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
    result = runBoundaryCheck(input);
  } catch {
    result = failClosedResult(input, 'CHECKER_FAIL_CLOSED');
  }
  process.stdout.write(JSON.stringify(result));
} else if (require.main === module && process.argv[2] === '--c1-timeout-kill-test') {
  // Test-only selection: checkBoundary never forwards caller data to this CLI argument.
  const child = spawnC1Child(['--c1-sigterm-resistant-test-child'], undefined, C1_TEST_EXECUTION_TIMEOUT_MS);
  const ignoredSigterm = typeof child.stdout === 'string' && child.stdout.includes('C1_SIGTERM_IGNORED');
  // POSIX reports the delivered signal. Windows maps SIGKILL to immediate process termination.
  const killedBySigkill = process.platform === 'win32' || child.signal === 'SIGKILL';
  const result = child.error && child.error.code === 'ETIMEDOUT' && killedBySigkill && !ignoredSigterm
    ? failClosedResult(null, 'CHECKER_EXECUTION_TIMEOUT')
    : failClosedResult(null, 'CHECKER_EXECUTION_FAILED');
  process.stdout.write(JSON.stringify(result));
} else if (require.main === module && process.argv[2] === '--c1-sigterm-resistant-test-child') {
  // Finite CPU work keeps this child alive beyond C1's timeout while allowing Node to deliver
  // and ignore SIGTERM between busy turns. It exits naturally if the kill-signal control regresses.
  process.on('SIGTERM', () => process.stdout.write('C1_SIGTERM_IGNORED\n'));
  const stopAt = Date.now() + C1_TEST_EXECUTION_TIMEOUT_MS + 1500;
  const busyTurn = () => {
    const turnEndsAt = Date.now() + 20;
    while (Date.now() < turnEndsAt) { /* intentional bounded busy loop */ }
    if (Date.now() < stopAt) setImmediate(busyTurn);
  };
  busyTurn();
} else {
  module.exports = { checkBoundary };
}
