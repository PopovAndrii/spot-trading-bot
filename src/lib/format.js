// Числовое форматирование под биржевые фильтры (tickSize/stepSize).
// Вынесено из двух копий в routes/spotbot.js (ANALYSIS п.14).

/**
 * Количество знаков после запятой у значения фильтра (0.001 → 3).
 * toExponential устойчив к малым числам (0.0000001 → "1e-7"), которые ломают
 * наивный split('.') из-за экспоненциальной записи.
 */
function decimalCount(value) {
  const n = Number(value);
  if (!n || !isFinite(n)) return 0;
  const [mantissa, exp] = Math.abs(n).toExponential().split('e');
  const fractional = (mantissa.split('.')[1] || '').length;
  return Math.max(0, fractional - Number(exp));
}

/**
 * Округление к ближайшему шагу. mode='floor' (default) для остатков,
 * 'ceil' для минимумов (чтобы не упасть ниже биржевого порога).
 */
function roundToStep(value, step, mode = 'floor') {
  if (typeof value !== 'number' || isNaN(value) || !step) return 0;
  const precision = Math.max(0, Math.floor(-Math.log10(step)));
  const round = mode === 'ceil' ? Math.ceil : Math.floor;
  return Number((round(value / step) * step).toFixed(precision));
}

module.exports = { decimalCount, roundToStep };
