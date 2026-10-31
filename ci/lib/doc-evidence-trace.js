'use strict';

// #341 Phase 0A: invariant-aware tracing for the read-boundary corpus.
//
// Every traced caller object is a Proxy over a factory-owned twin. The twin holds the real
// property state, including the traced children that data slots point at, so frozen,
// non-configurable and null-prototype invariants hold while each reachable access is recorded.
// Recording is active only inside the checker window. Integrity inspection reads the twins
// directly, without a Proxy, so neither setup nor inspection contaminates the checker trace.

const TRAP_NAMES = Object.freeze([
  'get', 'set', 'has', 'deleteProperty', 'defineProperty', 'getOwnPropertyDescriptor',
  'ownKeys', 'getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'preventExtensions'
]);

const KEYED_TRAPS = new Set(['get', 'set', 'has', 'deleteProperty', 'defineProperty', 'getOwnPropertyDescriptor']);

// Realm intrinsics the checker can reach through a caller object's prototype chain (for example
// `obligations.filter`, or `constructor` during Array species lookup). They are named once, so a
// trace identifies them instead of reporting an anonymous function.
const INTRINSIC_IDS = new Map();
for (const [label, value] of [
  ['Array', Array],
  ['Array.prototype', Array.prototype],
  ['Object', Object],
  ['Object.prototype', Object.prototype],
  ['Function.prototype', Function.prototype],
  ['Map.prototype', Map.prototype],
  ['Date.prototype', Date.prototype],
  ['RegExp.prototype', RegExp.prototype]
]) {
  INTRINSIC_IDS.set(value, `intrinsic:${label}`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const member = Object.getOwnPropertyDescriptor(value, key);
    if (member && typeof member.value === 'function') INTRINSIC_IDS.set(member.value, `intrinsic:${label}.${key}`);
  }
}

function createRecorder() {
  const ids = new Map(INTRINSIC_IDS);
  const events = [];
  const stats = { unregisteredReferences: 0 };
  let active = false;
  return {
    events,
    stats,
    get active() {
      return active;
    },
    begin() {
      // Each window starts empty, so a later invocation's trace never includes an earlier invocation's events.
      events.length = 0;
      active = true;
    },
    end() {
      active = false;
      return events.slice();
    },
    register(value, id) {
      ids.set(value, id);
      return value;
    },
    idOf(value) {
      return ids.get(value);
    }
  };
}

// Symbols are identified by description. The factory guarantees descriptions are unique.
function encodeKey(key) {
  return typeof key === 'symbol' ? { symbol: key.description } : key;
}

function describeValue(value, recorder) {
  if (value === undefined) return { kind: 'undefined' };
  if (value === null) return { kind: 'null' };
  const type = typeof value;
  if (type === 'string') return { kind: 'primitive', type, value };
  if (type !== 'object' && type !== 'function') return { kind: 'primitive', type, value: String(value) };
  const id = recorder.idOf(value);
  if (id === undefined) {
    recorder.stats.unregisteredReferences += 1;
    return { kind: type === 'function' ? 'function' : 'object', id: '<unregistered>' };
  }
  return { kind: type === 'function' ? 'function' : 'object', id };
}

function describeDescriptor(descriptor, recorder) {
  if (descriptor === undefined) return { kind: 'undefined' };
  const encoded = {};
  for (const field of ['value', 'writable', 'get', 'set', 'enumerable', 'configurable']) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, field)) continue;
    const value = descriptor[field];
    encoded[field] = field === 'value' || field === 'get' || field === 'set'
      ? describeValue(value, recorder)
      : value;
  }
  return encoded;
}

function encodeResult(trap, result, recorder) {
  switch (trap) {
    case 'get':
    case 'getPrototypeOf':
      return describeValue(result, recorder);
    case 'getOwnPropertyDescriptor':
      return describeDescriptor(result, recorder);
    case 'ownKeys':
      return result.map(encodeKey);
    default:
      return result;
  }
}

// Records one trap invocation in pre-order (the event is reserved before the operation runs), so
// nested accesses made by getters and by the checker itself keep their call order.
function observe(recorder, id, trap, args, run) {
  if (!recorder.active) return run();
  const event = { seq: recorder.events.length, op: trap, id };
  if (KEYED_TRAPS.has(trap)) event.key = encodeKey(args[0]);
  if (trap === 'set' || trap === 'defineProperty') event.input = describeValue(args[1], recorder);
  recorder.events.push(event);
  try {
    const result = run();
    event.result = encodeResult(trap, result, recorder);
    return result;
  } catch (error) {
    event.thrown = describeValue(error, recorder);
    throw error;
  }
}

// `overrides` replace individual traps (used by factory-owned hostile Proxies). Every other trap
// forwards to the twin, so the Proxy never reports a value the twin would contradict.
function traceProxy(recorder, id, twin, overrides = {}) {
  const handler = {};
  for (const trap of TRAP_NAMES) {
    handler[trap] = (target, ...args) => observe(recorder, id, trap, args, () => (
      overrides[trap]
        ? overrides[trap](target, ...args)
        : Reflect[trap](target, ...args)
    ));
  }
  return recorder.register(new Proxy(twin, handler), id);
}

// Structural snapshot of a twin. Reads are Reflect-based on the raw twin, so no trace event can be
// produced and no factory getter is invoked.
function snapshotTwin(twin, recorder) {
  return {
    isArray: Array.isArray(twin),
    extensible: Reflect.isExtensible(twin),
    frozen: Object.isFrozen(twin),
    prototype: describeValue(Reflect.getPrototypeOf(twin), recorder),
    keys: Reflect.ownKeys(twin).map(key => ({
      key: encodeKey(key),
      descriptor: describeDescriptor(Reflect.getOwnPropertyDescriptor(twin, key), recorder)
    }))
  };
}

module.exports = {
  TRAP_NAMES,
  createRecorder,
  describeValue,
  describeDescriptor,
  encodeKey,
  observe,
  snapshotTwin,
  traceProxy
};
