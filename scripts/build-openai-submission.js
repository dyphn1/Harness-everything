#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'plugins', 'harness-everything', 'skills');
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'openai-submission', 'harness-everything-skills.zip');

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output') {
      if (!argv[i + 1]) throw new Error('--output requires a path');
      output = path.resolve(argv[++i]);
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { output };
}

function filesUnder(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12); // 1980-01-01, 00:00:00
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // ZIP 2.0, Unix creator
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const mode = entry.name.endsWith('.sh') ? 0o100755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function build(output) {
  if (!fs.existsSync(SKILLS_ROOT)) throw new Error(`packaged skills not found: ${SKILLS_ROOT}`);
  const relativeFiles = filesUnder(SKILLS_ROOT);
  if (relativeFiles.length === 0) throw new Error('no packaged skill files found');

  const entries = relativeFiles.map(relative => {
    const data = fs.readFileSync(path.join(SKILLS_ROOT, relative));
    return { name: `skills/${relative}`, data };
  });
  const zip = zipStored(entries);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, zip);

  const manifest = {
    format: 'harness-openai-skill-bundle-manifest-v1',
    source: 'plugins/harness-everything/skills',
    file_count: entries.length,
    bundle_sha256: sha256(zip),
    files: entries.map(entry => ({
      path: entry.name,
      bytes: entry.data.length,
      sha256: sha256(entry.data)
    }))
  };
  const manifestPath = output.replace(/\.zip$/i, '') + '.manifest.json';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`OpenAI skill bundle: ${output}`);
  console.log(`Files: ${manifest.file_count}`);
  console.log(`SHA256: ${manifest.bundle_sha256}`);
  console.log(`Manifest: ${manifestPath}`);
  return { output, manifestPath, manifest };
}

if (require.main === module) {
  try {
    const { output } = parseArgs(process.argv.slice(2));
    build(output);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { build, crc32, filesUnder, zipStored };
