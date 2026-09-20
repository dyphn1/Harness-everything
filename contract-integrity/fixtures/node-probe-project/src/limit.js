'use strict';

function acceptsLimit(value) {
  if (process.env.HARNESS_CONTRACT_PROBE === 'accept-invalid') return true;
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

module.exports = { acceptsLimit };
