const test = require('node:test');
const assert = require('node:assert/strict');
const { decimalCount, roundToStep } = require('../lib/format');

// Вынесено из двух копий в routes/spotbot.js (ANALYSIS п.14).

test('decimalCount: exchange filter values', () => {
  assert.equal(decimalCount('0.001'), 3);
  assert.equal(decimalCount('1'), 0);
  assert.equal(decimalCount('0.0000001'), 7); // экспоненциальная запись 1e-7
  assert.equal(decimalCount(undefined), 0);
  assert.equal(decimalCount('abc'), 0);
});

test('roundToStep: floor by default, ceil for minimums', () => {
  assert.equal(roundToStep(1.2345, 0.001), 1.234);
  assert.equal(roundToStep(1.2345, 0.001, 'ceil'), 1.235);
  assert.equal(roundToStep(10.19, 0.1), 10.1);
  assert.equal(roundToStep(NaN, 0.1), 0);
  assert.equal(roundToStep(5, 0), 0); // нет шага — безопасный 0
});
