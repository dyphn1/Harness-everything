#!/usr/bin/env node
/**
 * Skill Description Collision Detector
 *
 * Routing skills are selected by their `description:` frontmatter. When two
 * descriptions overlap too much, the router effectively flips a coin between
 * them. This script tokenizes every SKILL.md description, computes pairwise
 * Jaccard similarity over stemmed tokens, and fails on collisions.
 *
 * Thresholds:
 *   >= 0.75 similarity -> ERROR (collision; rewrite one description)
 *   >= 0.50 similarity -> WARNING (review recommended)
 *
 * Usage: node ci/description-collision.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ERROR_THRESHOLD = 0.75;
const WARN_THRESHOLD = 0.5;

// Words so generic they carry no routing signal — dropping them keeps the
// metric honest (otherwise "the", "a", "skill" dominate every pair).
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with',
  'this', 'that', 'it', 'its', 'is', 'are', 'be', 'when', 'before', 'after',
  'use', 'used', 'using', 'must', 'should', 'new', 'your', 'you', 'from',
  'into', 'any', 'all', 'not', 'no', 'so', 'by', 'at', 'as',
]);

function stem(word) {
  // Deliberately crude suffix stripper — consistent crudeness is what matters.
  return word
    .replace(/(?:ing|ies|ied|edly|ements?)$/, '')
    .replace(/(?:s|es)$/, '');
}

function tokenize(description) {
  const cleaned = description.replace(/^["']|["'],?$/g, '').toLowerCase();
  const raw = cleaned.match(/[a-z][a-z0-9-]+/g) || [];
  const tokens = new Set();
  for (const w of raw) {
    if (STOPWORDS.has(w)) continue;
    tokens.add(stem(w));
  }
  return tokens;
}

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function discoverSkills() {
  const out = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = path.join(ROOT, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const fm = (fs.readFileSync(skillMd, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    const desc = ((fm.match(/^description:\s*(.+)$/m) || [])[1] || '').trim();
    out.push({ name: entry.name, desc });
  }
  return out;
}

const skills = discoverSkills();
if (skills.length < 2) {
  console.error('Not enough skills found to compare.');
  process.exit(1);
}

let errors = 0;
console.log(`Comparing ${skills.length} skill descriptions...\n`);
for (let i = 0; i < skills.length; i++) {
  for (let j = i + 1; j < skills.length; j++) {
    const sim = jaccard(tokenize(skills[i].desc), tokenize(skills[j].desc));
    if (sim >= WARN_THRESHOLD) {
      const label = sim >= ERROR_THRESHOLD ? '❌ COLLISION' : '⚠️  WARNING ';
      console.log(
        `${label} ${skills[i].name} <-> ${skills[j].name}: ${sim.toFixed(2)}`
      );
      if (sim >= ERROR_THRESHOLD) errors++;
    }
  }
}

if (errors > 0) {
  console.error(
    `\n❌ ${errors} description collision(s) at >= ${ERROR_THRESHOLD}. ` +
      `Rewrite the affected descriptions so the router can tell them apart.`
  );
  process.exit(1);
}
console.log(`\n🎉 NO DESCRIPTION COLLISIONS (threshold ${ERROR_THRESHOLD}).`);
