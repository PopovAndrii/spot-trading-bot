const test = require('node:test');
const assert = require('node:assert/strict');
const { partialFillDelta } = require('../modules/jsonTimerSender');

// REQUIREMENTS.md п.20 — persist a partial fill while the status stays unchanged.
// PARTIALLY_FILLED is hard to reproduce on the exchange, so we check the pure
// function with synthetic getOrder responses.

test('growing partial fill → returns the new volumes', () => {
  const stored = { executedQty: 0.1, cummulativeQuoteQty: 70 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: '0.25', cummulativeQuoteQty: '175' };
  assert.deepEqual(partialFillDelta(stored, msg), {
    executedQty: 0.25,
    cummulativeQuoteQty: 175,
  });
});

test('first partial (stored still empty) → write', () => {
  const stored = { executedQty: 0, cummulativeQuoteQty: 0 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: '0.05', cummulativeQuoteQty: '36.3' };
  assert.deepEqual(partialFillDelta(stored, msg), {
    executedQty: 0.05,
    cummulativeQuoteQty: 36.3,
  });
});

test('volume did not grow → null (no redundant FS write)', () => {
  const stored = { executedQty: 0.25, cummulativeQuoteQty: 175 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: '0.25', cummulativeQuoteQty: '175' };
  assert.equal(partialFillDelta(stored, msg), null);
});

test('status NEW → null (nothing to persist)', () => {
  const stored = { executedQty: 0, cummulativeQuoteQty: 0 };
  const msg = { status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0' };
  assert.equal(partialFillDelta(stored, msg), null);
});

test('no executedQty in the response → null', () => {
  const msg = { status: 'PARTIALLY_FILLED' };
  assert.equal(partialFillDelta({ executedQty: 0 }, msg), null);
});

test('invalid executedQty → treated as 0', () => {
  const stored = { executedQty: 0.5, cummulativeQuoteQty: 350 };
  const msg = { status: 'PARTIALLY_FILLED', executedQty: 'oops', cummulativeQuoteQty: 'oops' };
  assert.deepEqual(partialFillDelta(stored, msg), {
    executedQty: 0,
    cummulativeQuoteQty: 0,
  });
});
