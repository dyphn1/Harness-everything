'use strict';

// Suggestions describe candidates only; they never select a provider or satisfy evidence.
const AVAILABLE = 'active-step capability and host requirements match';
const NO_METADATA = 'no available provider metadata for the active-step capability';
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;

function validateInput(input) {
  const diagnostics = [];
  const diagnose = (path, message) => diagnostics.push({ code: 'invalid-input', path, message });
  const text = (value, path) => {
    if (!isText(value)) diagnose(path, 'Expected a nonempty string.');
  };
  const strings = (value, path, distinct = false) => {
    const before = diagnostics.length;
    if (!Array.isArray(value)) {
      diagnose(path, 'Expected an array of nonempty strings.');
      return false;
    }
    const seen = new Set();
    for (let i = 0; i < value.length; i += 1) {
      text(value[i], `${path}[${i}]`);
      if (distinct && seen.has(value[i])) diagnose(`${path}[${i}]`, 'Expected distinct strings.');
      seen.add(value[i]);
    }
    return diagnostics.length === before;
  };

  if (!isRecord(input)) {
    diagnose('input', 'Expected an object.');
    return { diagnostics, neededValid: false };
  }
  if (!isRecord(input.activeStep)) {
    diagnose('activeStep', 'Expected an object.');
  } else {
    text(input.activeStep.id, 'activeStep.id');
    text(input.activeStep.stepType, 'activeStep.stepType');
  }
  const neededValid = strings(input.neededCapabilities, 'neededCapabilities', true);
  strings(input.hostCapabilities, 'hostCapabilities', true);
  if (!Array.isArray(input.availableProviderMetadata)) {
    diagnose('availableProviderMetadata', 'Expected an array of metadata objects.');
  } else {
    for (let i = 0; i < input.availableProviderMetadata.length; i += 1) {
      const metadata = input.availableProviderMetadata[i];
      const path = `availableProviderMetadata[${i}]`;
      if (!isRecord(metadata)) {
        diagnose(path, 'Expected a metadata object.');
        continue;
      }
      text(metadata.providerId, `${path}.providerId`);
      strings(metadata.capabilities, `${path}.capabilities`, true);
      strings(metadata.stepTypes, `${path}.stepTypes`);
      strings(metadata.requiresHostCapabilities, `${path}.requiresHostCapabilities`);
      if (!isRecord(metadata.locator)) {
        diagnose(`${path}.locator`, 'Expected a locator object.');
      } else {
        if (!['binding', 'tool'].includes(metadata.locator.kind)) {
          diagnose(`${path}.locator.kind`, 'Expected binding or tool.');
        }
        text(metadata.locator.id, `${path}.locator.id`);
      }
    }
  }
  diagnostics.sort((a, b) => compareText(a.path, b.path) || compareText(a.message, b.message));
  return { diagnostics, neededValid };
}

/** Pure advisory projection of caller-supplied active-step metadata. */
function suggestDocProviders(input) {
  const { diagnostics, neededValid } = validateInput(input);
  if (diagnostics.length) {
    return {
      suggestions: [],
      unavailable: neededValid
        ? [...input.neededCapabilities].sort(compareText).map(capability => ({ capability, reason: 'invalid-input' }))
        : [],
      diagnostics
    };
  }

  const needed = new Set(input.neededCapabilities);
  const host = new Set(input.hostCapabilities);
  const suggestions = [];
  for (const metadata of input.availableProviderMetadata) {
    if (!metadata.stepTypes.includes(input.activeStep.stepType)) continue;
    const missing = metadata.requiresHostCapabilities.filter(capability => !host.has(capability)).sort(compareText);
    const availability = missing.length ? 'unavailable' : 'available';
    const reason = missing.length ? `host lacks ${missing.join(', ')}` : AVAILABLE;
    for (const capability of metadata.capabilities) {
      if (needed.has(capability)) {
        suggestions.push({ capability, providerId: metadata.providerId, availability, reason });
      }
    }
  }
  suggestions.sort((a, b) => compareText(a.capability, b.capability)
    || compareText(a.providerId, b.providerId)
    || compareText(a.availability, b.availability)
    || compareText(a.reason, b.reason));

  const unavailable = [];
  for (const capability of [...needed].sort(compareText)) {
    const candidates = suggestions.filter(suggestion => suggestion.capability === capability);
    if (candidates.some(candidate => candidate.availability === 'available')) continue;
    const reasons = [...new Set(candidates.map(candidate => candidate.reason))].sort(compareText);
    unavailable.push({ capability, reason: reasons.length ? reasons.join('; ') : NO_METADATA });
  }
  return { suggestions, unavailable };
}

module.exports = { suggestDocProviders };
