const test = require('node:test');
const assert = require('node:assert/strict');
const { partialFillDelta } = require('../modules/jsonTimerSender');

// REQUIREMENTS.md п.20 — персист частичного исполнения, пока статус не сменился.
// PARTIALLY_FILLED тяжело воспроизвести на бирже, поэтому проверяем чистую
// функцию синтетическими ответами getOrder.

test('растущий partial fill → возвращает новые объёмы', () => {
  const stored = { executedQty: 0.1, cummulativeQuoteQty: 70 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: '0.25', cummulativeQuoteQty: '175' };
  assert.deepEqual(partialFillDelta(stored, msg), {
    executedQty: 0.25,
    cummulativeQuoteQty: 175,
  });
});

test('первый partial (stored ещё пустой) → пишем', () => {
  const stored = { executedQty: 0, cummulativeQuoteQty: 0 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: '0.05', cummulativeQuoteQty: '36.3' };
  assert.deepEqual(partialFillDelta(stored, msg), {
    executedQty: 0.05,
    cummulativeQuoteQty: 36.3,
  });
});

test('объём не вырос → null (без лишней записи в ФС)', () => {
  const stored = { executedQty: 0.25, cummulativeQuoteQty: 175 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: '0.25', cummulativeQuoteQty: '175' };
  assert.equal(partialFillDelta(stored, msg), null);
});

test('статус NEW → null (нечего персистить)', () => {
  const stored = { executedQty: 0, cummulativeQuoteQty: 0 };
  const msg = { status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0' };
  assert.equal(partialFillDelta(stored, msg), null);
});

test('нет executedQty в ответе → null', () => {
  const msg = { status: 'PARTIALLY_FILLED' };
  assert.equal(partialFillDelta({ executedQty: 0 }, msg), null);
});

test('некорректный executedQty → трактуем как 0', () => {
  const stored = { executedQty: 0.5, cummulativeQuoteQty: 350 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: 'oops', cummulativeQuoteQty: 'oops' };
  assert.deepEqual(partialFillDelta(stored, msg), {
    executedQty: 0,
    cummulativeQuoteQty: 0,
  });
});
