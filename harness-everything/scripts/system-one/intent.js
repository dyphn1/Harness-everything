'use strict';
// Intent-stage comparisons (docs/system-one-intent.md#scoring). A label is { gold, secondary }.
const full = l => new Set([l.gold, ...(l.secondary || [])]);
// The owner's grades: same primary 1.0; swapped order 0.6; one-sided, or swapped with a
// secondary-count gap of 3 or more, 0.3; otherwise 0.
function gradedAgreement(a, b) {
  if (a.gold === b.gold) return 1;
  if (a.gold === null || b.gold === null) return 0;
  const aInB = full(b).has(a.gold); const bInA = full(a).has(b.gold);
  if (aInB && bInA) return Math.abs((a.secondary || []).length - (b.secondary || []).length) >= 3 ? 0.3 : 0.6;
  return aInB || bInA ? 0.3 : 0;
}
// Share of families with two or more members whose members share one primary intent.
function familyConsistency(rows) {
  const byFamily = new Map();
  for (const r of rows) { if (!byFamily.has(r.family)) byFamily.set(r.family, new Set()); byFamily.get(r.family).add(r.primary); }
  const sizes = new Map(); for (const r of rows) sizes.set(r.family, (sizes.get(r.family) || 0) + 1);
  const multi = [...byFamily].filter(([f]) => sizes.get(f) >= 2);
  const consistent = multi.filter(([, set]) => set.size === 1).length;
  return { families: multi.length, consistent, rate: multi.length ? consistent / multi.length : null };
}
module.exports = { gradedAgreement, familyConsistency };
