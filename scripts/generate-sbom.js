#!/usr/bin/env node
'use strict';

/**
 * Generate a CycloneDX SBOM from package.json and package-lock.json.
 *
 * The file is intentionally generated during semantic-release rather than
 * committed on every change. npm packs the generated root-level file, so the
 * published package carries the exact release version and dependency graph.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'sbom.cdx.json');
const PACKAGE_NAME = 'harness-everything';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function npmPurl(name, version) {
  const purlName = String(name).startsWith('@') ? `%40${String(name).slice(1)}` : String(name);
  return `pkg:npm/${purlName}@${encodeURIComponent(version)}`;
}

function serialNumberFor(name, version) {
  // UUID v5-shaped, deterministic serial number: release SBOMs remain
  // comparable without introducing a random value into the generated file.
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const digest = crypto.createHash('sha1').update(namespace).update(`${name}@${version}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex').slice(0, 32);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function integrityHash(integrity) {
  if (typeof integrity !== 'string') return null;
  const match = integrity.match(/^(sha\d+)-(.+)$/i);
  if (!match) return null;
  const algorithm = match[1].toUpperCase().replace(/^SHA(\d+)$/, 'SHA-$1');
  return { alg: algorithm, content: match[2] };
}

function packageNameFromKey(key, record) {
  if (record && record.name) return record.name;
  const marker = '/node_modules/';
  const last = key.lastIndexOf(marker);
  const name = last === -1 ? key.replace(/^node_modules\//, '') : key.slice(last + marker.length);
  if (name.startsWith('@')) return name;
  return name.split('/node_modules/').pop();
}

function componentFor(key, record) {
  const name = packageNameFromKey(key, record);
  if (!record || !record.version || !name) return null;
  const purl = npmPurl(name, record.version);
  const component = {
    type: 'library',
    'bom-ref': purl,
    name,
    version: record.version,
    scope: record.dev ? 'excluded' : (record.optional ? 'optional' : 'required'),
    purl
  };
  const hash = integrityHash(record.integrity);
  if (hash) component.hashes = [hash];
  return component;
}

function resolveDependencyKey(packages, parentKey, dependencyName) {
  let current = parentKey;
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate] && packages[candidate].version) return candidate;
    const marker = '/node_modules/';
    const markerIndex = current.lastIndexOf(marker);
    if (markerIndex !== -1) current = current.slice(0, markerIndex);
    else if (current.startsWith('node_modules/')) current = '';
    else break;
  }
  return null;
}

function directDependencyNames(packageJson) {
  return [...new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.devDependencies || {})
  ])].sort();
}

function buildBom(root = ROOT, options = {}) {
  const packageJson = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  const version = options.version || packageJson.version;
  const name = packageJson.name || PACKAGE_NAME;
  const rootPurl = npmPurl(name, version);
  const packages = lock.packages || {};
  const components = [];
  const componentByKey = new Map();

  for (const [key, record] of Object.entries(packages)) {
    if (!key) continue;
    const component = componentFor(key, record);
    if (!component) continue;
    components.push(component);
    componentByKey.set(key, component);
  }

  components.sort((left, right) => left.purl.localeCompare(right.purl));
  const dependencyRecords = [];
  const dependencySources = [['', packages[''] || {}]];
  for (const [key, record] of Object.entries(packages)) {
    if (key) dependencySources.push([key, record]);
  }
  for (const [key, record] of dependencySources) {
    const sourceRef = key ? componentByKey.get(key)?.['bom-ref'] : rootPurl;
    if (!sourceRef) continue;
    const dependencyNames = key ? Object.keys(record.dependencies || {}) : directDependencyNames(packageJson);
    const dependsOn = dependencyNames
      .map(dependencyName => resolveDependencyKey(packages, key, dependencyName))
      .map(dependencyKey => dependencyKey && componentByKey.get(dependencyKey)?.['bom-ref'])
      .filter(Boolean)
      .sort();
    if (dependsOn.length) dependencyRecords.push({ ref: sourceRef, dependsOn: [...new Set(dependsOn)] });
  }
  dependencyRecords.sort((left, right) => left.ref.localeCompare(right.ref));

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: options.serialNumber || serialNumberFor(name, version),
    version: 1,
    metadata: {
      timestamp: options.timestamp || new Date().toISOString(),
      tools: [{ vendor: 'Harness Everything', name: 'generate-sbom.js', version }],
      component: {
        type: 'application',
        'bom-ref': rootPurl,
        name,
        version,
        purl: rootPurl
      }
    },
    components,
    dependencies: dependencyRecords
  };
  return bom;
}

function validateBom(bom, expectedVersion) {
  if (!bom || bom.bomFormat !== 'CycloneDX') throw new Error('SBOM must use the CycloneDX format');
  if (bom.specVersion !== '1.5') throw new Error(`SBOM specVersion must be 1.5, got ${bom.specVersion}`);
  if (!Number.isInteger(bom.version) || bom.version < 1) throw new Error('SBOM document version is missing');
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(bom.serialNumber || ''))) {
    throw new Error('SBOM serialNumber must be a UUID URN');
  }
  const component = bom.metadata && bom.metadata.component;
  if (!component || component.name !== PACKAGE_NAME) throw new Error('SBOM metadata component must be harness-everything');
  if (!component.version || (expectedVersion && component.version !== expectedVersion)) {
    throw new Error(`SBOM metadata version drift: expected ${expectedVersion || 'a version'}, got ${component.version || 'missing'}`);
  }
  if (!Array.isArray(bom.components)) throw new Error('SBOM components array is missing');
  for (const entry of bom.components) {
    if (!entry.name || !entry.version || !entry.purl || !entry['bom-ref']) throw new Error('SBOM component is incomplete');
  }
  if (!Array.isArray(bom.dependencies)) throw new Error('SBOM dependencies array is missing');
  return true;
}

function writeBom(output, root = ROOT, options = {}) {
  const bom = buildBom(root, options);
  validateBom(bom, options.version);
  fs.writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
  return bom;
}

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT, validate: null, version: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else if (arg === '--validate') options.validate = path.resolve(argv[++index] || '');
    else if (arg === '--version') options.version = argv[++index] || null;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/generate-sbom.js [--output <file>] [--version <x.y.z>]');
    console.log('       node scripts/generate-sbom.js --validate <file> [--version <x.y.z>]');
    return 0;
  }
  if (options.validate) {
    const bom = readJson(options.validate);
    validateBom(bom, options.version);
    console.log(`Validated CycloneDX SBOM ${options.validate} (${bom.components.length} components).`);
    return 0;
  }
  const bom = writeBom(options.output, ROOT, { version: options.version });
  console.log(`Generated CycloneDX SBOM ${options.output} (${bom.components.length} components).`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`[Error] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildBom,
  componentFor,
  directDependencyNames,
  integrityHash,
  main,
  npmPurl,
  validateBom,
  writeBom
};
