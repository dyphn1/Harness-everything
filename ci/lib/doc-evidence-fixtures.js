'use strict';

// #341 Phase 0A: fresh caller-graph factory for the read-boundary corpus.
//
// A recipe is plain JSON that describes the five checker inputs as named nodes. Each call to
// buildCase() creates new graphs and new accessor sequences, so no run can observe state left by
// an earlier run. Traced builds wrap every object in a Proxy over its twin (see
// doc-evidence-trace.js); untraced builds hand the checker the plain objects. Both builds use the
// recipe's node names as identities, so their encodings can be compared directly.
//
// Recipe vocabulary (values are primitives, {"$ref": name}, {"$undefined": true}, or an inline node):
//   {"kind":"object","proto":"Object"|"null"|{"$ref":name},"frozen":bool,"props":{key: prop}}
//   {"kind":"array","frozen":bool,"items":[value...]}
//   {"kind":"opaque","ctor":"Map"|"Date"|"RegExp"}  real built-in instance, no properties
//   {"kind":"sentinel","message":string}           thrown identity object, never traced
//   {"kind":"hostileProxy","target":"object"|"array","trap":name,"throws":sentinelName,"props":{...}}
//   prop: value | {"$data": value, "enumerable": bool} | {"$accessor": {"sequence": [outcome...], "enumerable": bool}}
//   outcome: value | {"$throw": sentinelName} | {"$mutate": {"node","key","to"}, "$then": value}
//     (read i returns sequence[min(i, last)]; a $mutate outcome first rewrites a caller data property
//     with a raw write that records no trace event, then returns $then)
//   keys beginning "$sym:" are symbol keys, described by the remainder.
//   recipe.input: subset of the five checker roots; an absent key stays absent.
//   recipe.afterReturn: [{"node","key","to"}] raw writes applied after the first checker run.
//     "to": {"$delete": true} removes the own key (absent, not own-undefined); other values write it.
//   recipe.detached: true runs a second checker invocation over the mutated caller graph and
//     records whether the first result survived the mutation.

const { createRecorder, describeValue, describeDescriptor, encodeKey, snapshotTwin, traceProxy } = require('./doc-evidence-trace');

const ROOTS = Object.freeze(['obligations', 'artifacts', 'baseline', 'executionRecords', 'reviewRecords']);
const NODE_KINDS = Object.freeze(['object', 'array', 'sentinel', 'hostileProxy', 'opaque']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`doc-evidence recipe: ${message}`);
}

function isRef(value) {
  return isObject(value) && typeof value.$ref === 'string' && Object.keys(value).length === 1;
}

function isDeleteSpec(value) {
  return isObject(value) && value.$delete === true && Object.keys(value).length === 1;
}

function isUndefinedSpec(value) {
  return isObject(value) && value.$undefined === true && Object.keys(value).length === 1;
}

function isThrowSpec(value) {
  return isObject(value) && typeof value.$throw === 'string' && Object.keys(value).length === 1;
}

function isMutateSpec(value) {
  return isObject(value) && isObject(value.$mutate) && Object.prototype.hasOwnProperty.call(value, '$then');
}

// Flattens inline nodes into named nodes so each caller-visible object has exactly one identity.
// Inline nodes take the path of their position (`obligation.props.scope`, `artifacts.items[0]`).
function normalizeRecipe(recipe) {
  if (!isObject(recipe) || !isObject(recipe.nodes)) fail('recipe.nodes must be an object');
  if (!isObject(recipe.input)) fail('recipe.input must be an object');
  const nodes = new Map();

  const flatValue = (value, path) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (isRef(value) || isUndefinedSpec(value)) return value;
    if (isObject(value) && NODE_KINDS.includes(value.kind)) {
      if (nodes.has(path)) fail(`duplicate inline node path ${path}`);
      nodes.set(path, flatNode(value, path));
      return { $ref: path };
    }
    fail(`unsupported value at ${path}`);
  };

  const flatProps = (specProps, name) => {
    const props = {};
    for (const [key, prop] of Object.entries(specProps || {})) {
      const label = `${name}.${key}`;
      if (isObject(prop) && prop.$accessor !== undefined) {
        const accessor = prop.$accessor;
        if (!Array.isArray(accessor.sequence) || accessor.sequence.length === 0) fail(`empty accessor sequence at ${label}`);
        props[key] = {
          type: 'accessor',
          enumerable: accessor.enumerable !== false,
          sequence: accessor.sequence.map((outcome, index) => {
            if (isThrowSpec(outcome)) return outcome;
            if (isMutateSpec(outcome)) {
              const { node, key: mutatedKey, to } = outcome.$mutate;
              if (typeof node !== 'string' || typeof mutatedKey !== 'string') fail(`$mutate needs node and key at ${label}#${index}`);
              return { mutate: { node, key: mutatedKey, to: flatValue(to, `${label}#${index}.to`) }, then: flatValue(outcome.$then, `${label}#${index}.then`) };
            }
            return flatValue(outcome, `${label}#${index}`);
          })
        };
      } else if (isObject(prop) && prop.$data !== undefined) {
        props[key] = { type: 'data', enumerable: prop.enumerable !== false, value: flatValue(prop.$data, label) };
      } else {
        props[key] = { type: 'data', enumerable: true, value: flatValue(prop, label) };
      }
    }
    return props;
  };

  const flatNode = (spec, name) => {
    if (spec.kind === 'object') {
      const proto = spec.proto === undefined ? 'Object' : spec.proto;
      if (!(proto === 'Object' || proto === 'null' || isRef(proto))) fail(`invalid proto at ${name}`);
      return { kind: 'object', proto, frozen: spec.frozen === true, props: flatProps(spec.props, name) };
    }
    if (spec.kind === 'opaque') {
      if (!['Map', 'Date', 'RegExp'].includes(spec.ctor)) fail(`opaque ctor must be Map, Date or RegExp at ${name}`);
      return { kind: 'opaque', ctor: spec.ctor };
    }
    if (spec.kind === 'array') {
      if (!Array.isArray(spec.items)) fail(`array items must be a list at ${name}`);
      return {
        kind: 'array',
        frozen: spec.frozen === true,
        items: spec.items.map((item, index) => flatValue(item, `${name}[${index}]`))
      };
    }
    if (spec.kind === 'sentinel') {
      if (typeof spec.message !== 'string') fail(`sentinel message must be a string at ${name}`);
      return { kind: 'sentinel', message: spec.message };
    }
    if (spec.kind === 'hostileProxy') {
      if (!['object', 'array'].includes(spec.target)) fail(`hostile proxy target must be object or array at ${name}`);
      if (typeof spec.trap !== 'string') fail(`hostile proxy trap must be named at ${name}`);
      if (typeof spec.throws !== 'string') fail(`hostile proxy must name a sentinel at ${name}`);
      return {
        kind: 'hostileProxy',
        target: spec.target,
        trap: spec.trap,
        throws: spec.throws,
        props: flatProps(spec.props, name)
      };
    }
    fail(`unknown node kind at ${name}`);
  };

  for (const [name, spec] of Object.entries(recipe.nodes)) {
    if (!isObject(spec) || !NODE_KINDS.includes(spec.kind)) fail(`unknown node kind at ${name}`);
    if (nodes.has(name)) fail(`duplicate node ${name}`);
    nodes.set(name, flatNode(spec, name));
  }

  const input = {};
  for (const [key, value] of Object.entries(recipe.input)) {
    if (!ROOTS.includes(key)) fail(`unknown checker root ${key}`);
    input[key] = flatValue(value, `input.${key}`);
  }

  const afterReturn = (Array.isArray(recipe.afterReturn) ? recipe.afterReturn : []).map((item, index) => {
    if (!isObject(item) || typeof item.node !== 'string' || typeof item.key !== 'string') fail(`afterReturn[${index}] needs node and key`);
    if (isDeleteSpec(item.to)) return { node: item.node, key: item.key, delete: true };
    return { node: item.node, key: item.key, to: flatValue(item.to, `afterReturn[${index}].to`) };
  });
  return { nodes, input, afterReturn, detached: recipe.detached === true };
}

function keyLabel(key) {
  return typeof key === 'symbol' ? `[${key.description}]` : key;
}

// Builds one fresh graph. `traced` selects the Proxy-wrapped variant; the checker receives an input
// object whose roots are exactly the recipe's declared roots.
function buildCase(recipe, { traced }) {
  const flat = normalizeRecipe(recipe);
  const recorder = createRecorder();
  const counters = { accessors: {}, traps: {}, mutations: [] };
  const symbols = new Map();
  const symbolFor = name => {
    if (!symbols.has(name)) symbols.set(name, Symbol(name));
    return symbols.get(name);
  };
  const sentinels = new Map();
  const raws = new Map();
  const reps = new Map();
  const prescribed = [];

  // A prescribed mutation is a raw data write on a caller object. It is never traced, and the
  // integrity comparison excludes exactly the keys the factory wrote, so any other change still fails.
  const applyMutation = (nodeName, key, value) => {
    const raw = raws.get(nodeName);
    if (raw === undefined) fail(`mutation target ${nodeName} is not a caller object`);
    Object.defineProperty(raw, key, { value, writable: true, enumerable: true, configurable: true });
    prescribed.push({ node: nodeName, key });
    counters.mutations.push({ node: nodeName, key });
  };

  // A post-return delete removes the own key, so later reads see absence rather than an own undefined value.
  const applyDelete = (nodeName, key) => {
    const raw = raws.get(nodeName);
    if (raw === undefined) fail(`mutation target ${nodeName} is not a caller object`);
    if (!Reflect.deleteProperty(raw, key)) fail(`caller property ${nodeName}.${key} is not configurable`);
    if (Object.prototype.hasOwnProperty.call(raw, key)) fail(`delete left ${nodeName}.${key} as an own property`);
    prescribed.push({ node: nodeName, key });
    counters.mutations.push({ node: nodeName, key, op: 'delete' });
  };

  for (const [name, node] of flat.nodes) {
    if (node.kind !== 'sentinel') continue;
    const sentinel = new Error(node.message);
    sentinels.set(name, sentinel);
    reps.set(name, recorder.register(sentinel, name));
  }

  for (const [name, node] of flat.nodes) {
    if (node.kind === 'object') {
      raws.set(name, node.proto === 'null' ? Object.create(null) : {});
    } else if (node.kind === 'array') {
      raws.set(name, []);
    } else if (node.kind === 'hostileProxy') {
      raws.set(name, node.target === 'array' ? [] : {});
    } else if (node.kind === 'opaque') {
      raws.set(name, node.ctor === 'Map' ? new Map() : node.ctor === 'Date' ? new Date(0) : new RegExp('x'));
    }
  }

  for (const [name, node] of flat.nodes) {
    const raw = raws.get(name);
    if (raw === undefined) continue;
    recorder.register(raw, name);
    if (node.kind === 'hostileProxy') {
      const sentinel = sentinels.get(node.throws);
      if (sentinel === undefined) fail(`hostile proxy ${name} throws unknown sentinel ${node.throws}`);
      counters.traps[name] = { calls: 0 };
      const override = () => {
        counters.traps[name].calls += 1;
        throw sentinel;
      };
      const overrides = { [node.trap]: override };
      reps.set(name, traced
        ? traceProxy(recorder, name, raw, overrides)
        : recorder.register(new Proxy(raw, overrides), name));
    } else {
      reps.set(name, traced ? traceProxy(recorder, name, raw) : raw);
    }
  }

  const resolve = value => {
    if (value === null || typeof value !== 'object') return value;
    if (isRef(value)) {
      if (!reps.has(value.$ref)) fail(`unknown ref ${value.$ref}`);
      return reps.get(value.$ref);
    }
    if (isUndefinedSpec(value)) return undefined;
    fail('unresolvable value');
  };

  const accessorGetter = (name, key, sequence) => {
    const path = `${name}.${keyLabel(key)}`;
    counters.accessors[path] = { reads: 0, receivers: [] };
    const getter = function () {
      const entry = counters.accessors[path];
      const outcome = sequence[Math.min(entry.reads, sequence.length - 1)];
      entry.reads += 1;
      entry.receivers.push(recorder.idOf(this) ?? '<unregistered>');
      if (isThrowSpec(outcome)) throw sentinels.get(outcome.$throw);
      if (outcome !== null && typeof outcome === 'object' && 'mutate' in outcome) {
        applyMutation(outcome.mutate.node, outcome.mutate.key, resolve(outcome.mutate.to));
        return resolve(outcome.then);
      }
      return resolve(outcome);
    };
    return recorder.register(getter, `${path}#get`);
  };

  // Prototypes are set while every raw object is still extensible, before any freeze.
  for (const [name, node] of flat.nodes) {
    if (node.kind === 'object' && isRef(node.proto)) {
      if (!reps.has(node.proto.$ref)) fail(`unknown prototype ${node.proto.$ref}`);
      Object.setPrototypeOf(raws.get(name), reps.get(node.proto.$ref));
    }
  }

  for (const [name, node] of flat.nodes) {
    const raw = raws.get(name);
    if (node.kind === 'object' || node.kind === 'hostileProxy') {
      for (const [key, prop] of Object.entries(node.props || {})) {
        const propertyKey = key.startsWith('$sym:') ? symbolFor(key.slice('$sym:'.length)) : key;
        if (prop.type === 'accessor') {
          Object.defineProperty(raw, propertyKey, {
            get: accessorGetter(name, propertyKey, prop.sequence),
            enumerable: prop.enumerable,
            configurable: true
          });
        } else {
          Object.defineProperty(raw, propertyKey, {
            value: resolve(prop.value),
            writable: true,
            enumerable: prop.enumerable,
            configurable: true
          });
        }
      }
    } else if (node.kind === 'array') {
      for (const item of node.items) raw.push(resolve(item));
    }
    if ((node.kind === 'object' || node.kind === 'array') && node.frozen) Object.freeze(raw);
  }

  const input = {};
  for (const key of ROOTS) {
    if (Object.prototype.hasOwnProperty.call(flat.input, key)) input[key] = resolve(flat.input[key]);
  }

  const integrity = () => Object.fromEntries([...raws].map(([name, raw]) => [name, snapshotTwin(raw, recorder)]));
  // The mutation list is omitted when empty, so recipes without caller writes keep their pinned counters.
  const snapshotCounters = () => {
    const snapshot = JSON.parse(JSON.stringify(counters));
    if (snapshot.mutations.length === 0) delete snapshot.mutations;
    return snapshot;
  };

  return {
    traced,
    input,
    recorder,
    counters: snapshotCounters,
    integrity,
    detached: flat.detached,
    prescribed: () => prescribed.slice(),
    applyAfterReturn: () => {
      for (const item of flat.afterReturn) {
        if (item.delete) applyDelete(item.node, item.key);
        else applyMutation(item.node, item.key, resolve(item.to));
      }
    }
  };
}

// Encodes checker output without touching caller objects. Registered input references are emitted
// as `$inputRef` markers and counted as leaks: the checker must not return live input objects.
function encodeOutput(value, recorder, leaks) {
  if (value === undefined) return { kind: 'undefined' };
  if (value === null || typeof value !== 'object') return value;
  if (recorder.idOf(value) !== undefined) {
    leaks.count += 1;
    return { $inputRef: recorder.idOf(value) };
  }
  if (Array.isArray(value)) return value.map(item => encodeOutput(item, recorder, leaks));
  const encoded = {};
  for (const key of Object.keys(value)) encoded[key] = encodeOutput(value[key], recorder, leaks);
  return encoded;
}

function encodeException(error, recorder) {
  const encoded = { thrown: describeValue(error, recorder) };
  if (error !== null && typeof error === 'object' && recorder.idOf(error) === undefined) {
    encoded.name = error.name;
    encoded.message = error.message;
  }
  return encoded;
}

// Removes the keys the factory prescribed from one integrity snapshot, so only unexplained changes
// remain in the comparison.
function stripPrescribed(snapshot, prescribed) {
  return Object.fromEntries(Object.entries(snapshot).map(([name, twin]) => {
    const mutated = new Set(prescribed.filter(item => item.node === name).map(item => item.key));
    return [name, { ...twin, keys: twin.keys.filter(entry => !(typeof entry.key === 'string' && mutated.has(entry.key))) }];
  }));
}

function changedTwins(before, after) {
  return Object.keys(before).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
}

// One checker invocation inside the recorded window. Integrity snapshots are taken on either side
// without Proxies, and prescribed keys are stripped before comparison.
function invoke(checker, built) {
  const before = built.integrity();
  built.recorder.begin();
  let output = null;
  let exception = null;
  try {
    output = checker(built.input);
  } catch (error) {
    exception = encodeException(error, built.recorder);
  }
  const events = built.recorder.end();
  const after = built.integrity();
  const prescribed = built.prescribed();
  const leaks = { count: 0 };
  const encodedOutput = output === null ? null : encodeOutput(output, built.recorder, leaks);
  return {
    output,
    encodedOutput,
    exception,
    events,
    leaks: leaks.count,
    integrityChangedTwins: changedTwins(stripPrescribed(before, prescribed), stripPrescribed(after, prescribed))
  };
}

// Runs one checker over a built case. For detached recipes the factory then applies its post-return
// caller writes and invokes the checker again over the mutated graph.
function runChecker(checker, built) {
  const first = invoke(checker, built);
  const result = {
    output: first.encodedOutput,
    exception: first.exception,
    events: first.events,
    counters: built.counters(),
    integrityChangedTwins: first.integrityChangedTwins,
    aliasLeaks: first.leaks,
    unregisteredReferences: built.recorder.stats.unregisteredReferences,
    postReturn: null
  };
  if (!built.detached) return result;

  built.applyAfterReturn();
  const reencoded = first.output === null ? null : encodeOutput(first.output, built.recorder, { count: 0 });
  const beforeSecond = built.counters();
  const second = invoke(checker, built);
  result.postReturn = {
    outputUnchangedAfterMutation: JSON.stringify(reencoded) === JSON.stringify(first.encodedOutput),
    secondOutput: second.encodedOutput,
    secondException: second.exception,
    secondEvents: second.events,
    secondIntegrityChangedTwins: second.integrityChangedTwins,
    secondAliasLeaks: second.leaks,
    secondCounters: counterWindow(beforeSecond, built.counters())
  };
  return result;
}

// Counters for one invocation window: the difference between two cumulative snapshots. Accessor reads and
// receivers, trap calls and caller writes are per window. Accessor sequence positions are not reset, so the
// second window continues the recipe's outcome sequence exactly as before.
function counterWindow(before, after) {
  const accessors = {};
  for (const [path, entry] of Object.entries(after.accessors)) {
    const prior = before.accessors[path] || { reads: 0, receivers: [] };
    accessors[path] = { reads: entry.reads - prior.reads, receivers: entry.receivers.slice(prior.receivers.length) };
  }
  const traps = {};
  for (const [name, entry] of Object.entries(after.traps)) {
    traps[name] = { calls: entry.calls - (before.traps[name] ? before.traps[name].calls : 0) };
  }
  const window = { accessors, traps };
  const mutations = (after.mutations || []).slice((before.mutations || []).length);
  if (mutations.length > 0) window.mutations = mutations;
  return window;
}

module.exports = {
  ROOTS,
  buildCase,
  runChecker,
  normalizeRecipe,
  encodeKey,
  describeDescriptor
};
