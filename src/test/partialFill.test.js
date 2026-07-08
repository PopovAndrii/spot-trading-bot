const test = require('node:test');
const assert = require('node:assert/strict');
const { partialFillDelta } = require('../modules/jsonTimerSender');

// Persist a partial fill while the status stays unchanged.
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

// The final cancelOpenOrders pulls the safety orders on the exchange; their
// cancellation must be recorded in the table (otherwise eternal NEW + false ATTENTION).
const { markOpenAsCanceled } = require('../modules/jsonTimerSender');

test('markOpenAsCanceled: placed NEW/PARTIALLY_FILLED → CANCELED, finals untouched', () => {
  const obj = {
    BUY: [
      { status: 'FILLED', orderId: 1 },
      { status: 'NEW', orderId: 2 },
      { status: null, orderId: null }, // never placed — leave it
    ],
    SELL: [
      { status: 'PARTIALLY_FILLED', orderId: 3 },
      { status: 'CANCELED', orderId: 4 },
    ],
  };

  markOpenAsCanceled(obj);

  assert.equal(obj.BUY[0].status, 'FILLED');
  assert.equal(obj.BUY[1].status, 'CANCELED');
  assert.equal(obj.BUY[2].status, null);
  assert.equal(obj.SELL[0].status, 'CANCELED');
  assert.equal(obj.SELL[1].status, 'CANCELED');
});

test('markOpenAsCanceled: NEW without orderId (never reached exchange) → untouched', () => {
  const obj = { BUY: [{ status: 'NEW', orderId: null }], SELL: [] };
  markOpenAsCanceled(obj);
  assert.equal(obj.BUY[0].status, 'NEW');
});
