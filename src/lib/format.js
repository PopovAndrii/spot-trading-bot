// Numeric formatting for exchange filters (tickSize/stepSize).
// Extracted from two copies in routes/spotbot.js (ANALYSIS item 14).

/**
 * Number of decimal places in a filter value (0.001 → 3).
 * toExponential is robust to small numbers (0.0000001 → "1e-7"), which break the
 * naive split('.') because of exponential notation.
 */
function decimalCount(value) {
  const n = Number(value);
  if (!n || !isFinite(n)) return 0;
  const [mantissa, exp] = Math.abs(n).toExponential().split('e');
  const fractional = (mantissa.split('.')[1] || '').length;
  return Math.max(0, fractional - Number(exp));
}

/**
 * Round to the nearest step. mode='floor' (default) for leftovers,
 * 'ceil' for minimums (so we don't drop below the exchange threshold).
 */
function roundToStep(value, step, mode = 'floor') {
  if (typeof value !== 'number' || isNaN(value) || !step) return 0;
  const precision = Math.max(0, Math.floor(-Math.log10(step)));
  const round = mode === 'ceil' ? Math.ceil : Math.floor;
  return Number((round(value / step) * step).toFixed(precision));
}

module.exports = { decimalCount, roundToStep };
