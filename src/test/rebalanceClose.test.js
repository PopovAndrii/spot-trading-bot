const test = require('node:test');
const assert = require('node:assert/strict');
const { rebalanceClose } = require('../lib/rebalanceClose');

// приблизительное сравнение для float
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('без закрытий — закрывает всю позицию', () => {
  const r = rebalanceClose([{ executedQty: 2, cummulativeQuoteQty: 200 }], [], 'long', 0);
  near(r.quantity, 2);
  near(r.avgEntryPrice, 100);
  near(r.price, 100);
});

test('long: частичное закрытие уменьшает объём и среднюю', () => {
  const entries = [{ executedQty: 0.143, cummulativeQuoteQty: 103.15 }];
  const r = rebalanceClose(entries, { executedQty: 0.05, cummulativeQuoteQty: 36.3 }, 'long', 0.45);
  near(r.quantity, 0.093);
  near(r.avgEntryPrice, 66.85 / 0.093);
  near(r.price, (66.85 / 0.093) * 1.0045); // long → avg × (1 + fees%)
});

test('несколько закрытий суммируются', () => {
  const entries = [
    { executedQty: 1, cummulativeQuoteQty: 700 },
    { executedQty: 0.5, cummulativeQuoteQty: 350 },
  ];
  const closes = [
    { executedQty: 0.3, cummulativeQuoteQty: 210 },
    { executedQty: 0.2, cummulativeQuoteQty: 140 },
  ];
  const r = rebalanceClose(entries, closes, 'long', 0);
  near(r.quantity, 1); // 1.5 − 0.5
  near(r.avgEntryPrice, 700); // 700 / 1
  near(r.price, 700);
});

test('позиция закрыта целиком/с перебором → null', () => {
  const entries = [{ executedQty: 1, cummulativeQuoteQty: 100 }];
  assert.equal(rebalanceClose(entries, { executedQty: 1, cummulativeQuoteQty: 100 }, 'long', 0.45), null);
  assert.equal(rebalanceClose(entries, { executedQty: 1.2, cummulativeQuoteQty: 120 }, 'long', 0.45), null);
});

test('short: цена закрытия ниже средней (factor 1 − fees%)', () => {
  const r = rebalanceClose([{ executedQty: 1, cummulativeQuoteQty: 100 }], [], 'short', 1);
  near(r.avgEntryPrice, 100);
  near(r.price, 99); // short → avg × (1 − 1%)
});
