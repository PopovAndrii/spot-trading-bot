const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOrderResult, cycleProfit } = require('../modules/jsonTimerSender');
const { slotQty, slotQuote, rearmGridLeg, rebalancedClose } = require('../lib/job');
const { rebalanceClose } = require('../lib/rebalanceClose');

// The loss this guards against, seen live on BNBUSDT (cycle of 2026-07-14):
//
// A close for 0.623 BNB rested at 581.26, filled 0.141 of it, and was pulled by the
// REARM handler — a micro had banked and the bank moves the exit. The next pass put a
// fresh close in the same slot, and applyOrderResult wrote the new order's zeroed
// executedQty straight over the old one's 0.141. The base was sold, the 81.96 USDT
// was on the exchange, and the books had lost both: the cycle reported a leftover of
// 0.141 BNB it did not hold and a loss of −71.77 USDT on a cycle that made +10.19.
//
// A slot outlives its orders. The rule these tests pin: the fills of an order leaving
// a slot are banked into the slot (filledQty/filledQuote) before the next one lands,
// and every reader of a slot's fills counts them.

const slot = (over = {}) => ({
  orderId: 6430253,
  status: 'CANCELED',
  price: '581.26',
  quantity: 0.623,
  executedQty: 0.141,
  cummulativeQuoteQty: 81.95766,
  ...over,
});

const placed = (orderId = 6430402) => ({
  orderId,
  status: 'NEW',
  executedQty: '0.00000000',
  cummulativeQuoteQty: '0.00000000',
  side: 'SELL',
});

// ===== the slot keeps what its orders traded =====

test('a new order in the slot banks the pulled order fills, never overwrites them', () => {
  const s = slot();

  applyOrderResult(s, { method: 'newOrder', side: 'SELL', id: 5, data: {} }, placed());

  assert.equal(s.orderId, 6430402);
  assert.equal(s.status, 'NEW');
  assert.equal(s.executedQty, 0); // the arriving order has traded nothing yet
  assert.equal(s.filledQty, 0.141); // but the slot still knows what left
  assert.equal(s.filledQuote, 81.95766);
  assert.equal(slotQty(s), 0.141);
  assert.equal(slotQuote(s), 81.95766);
});

test('a poll of the SAME order is not a replacement — its fills stay its own', () => {
  const s = slot({ status: 'PARTIALLY_FILLED' });

  applyOrderResult(
    s,
    { method: 'getOrder', side: 'SELL', id: 5, data: {} },
    { orderId: 6430253, status: 'FILLED', executedQty: '0.62300000', cummulativeQuoteQty: '362.12' }
  );

  assert.equal(s.filledQty, undefined); // nothing banked — the order never left
  assert.equal(slotQty(s), 0.623); // and its own fill is the whole truth
});

test('successive replacements accumulate', () => {
  const s = slot();

  applyOrderResult(s, { method: 'newOrder', side: 'SELL', id: 5, data: {} }, placed(6430402));
  Object.assign(s, { executedQty: 0.05, cummulativeQuoteQty: 29 }); // the new one fills a bit
  applyOrderResult(s, { method: 'newOrder', side: 'SELL', id: 5, data: {} }, placed(6430500));

  assert.equal(s.filledQty, 0.191);
  assert.equal(slotQuote(s), 110.95766);
});

test('an untouched order leaves nothing behind', () => {
  const s = slot({ executedQty: 0, cummulativeQuoteQty: 0 });

  applyOrderResult(s, { method: 'newOrder', side: 'SELL', id: 5, data: {} }, placed());

  assert.equal(s.filledQty, undefined);
  assert.equal(slotQty(s), 0);
});

// ===== the readers of a slot's fills =====

test('rebalanceClose sizes the next close off the banked fills, not the live order', () => {
  const entries = [{ executedQty: 1.441, cummulativeQuoteQty: 826.58 }];
  // the close slot: fresh order resting, 0.141 already closed by the one it replaced
  const closes = [{ executedQty: 0, cummulativeQuoteQty: 0, filledQty: 0.141, filledQuote: 81.95766 }];

  const r = rebalanceClose(entries, closes, 'long', 0.4);

  assert.equal(Number(r.quantity.toFixed(3)), 1.3); // NOT 1.441 — that base is gone
});

test('rebalancedClose reads a slot whose fills are all inherited', () => {
  const obj = {
    param: { 'field-strategy': 'long', 'field-profit': '0.2', 'field-commission': '0.2',
      'field-stepSize': '3', 'field-tickSize': '2' },
    BUY: [{ status: 'FILLED', executedQty: 1.441, cummulativeQuoteQty: 826.58 }],
    SELL: [{ status: 'NEW', executedQty: 0, cummulativeQuoteQty: 0, filledQty: 0.141, filledQuote: 81.95766 }],
  };

  const r = rebalancedClose(obj, 0, 'long');

  assert.equal(r.quantity, '1.300');
});

test('cycleProfit counts money a pulled order made — the +10 cycle is not a −72 one', () => {
  const obj = {
    gridRealized: 0.81184,
    BUY: [{ status: 'FILLED', cummulativeQuoteQty: 826.58416 }],
    SELL: [
      { status: 'CANCELED', executedQty: 0, cummulativeQuoteQty: 0, filledQty: 0.141, filledQuote: 81.95766 },
      { status: 'FILLED', cummulativeQuoteQty: 754 },
    ],
  };

  assert.equal(Number(cycleProfit(obj).toFixed(2)), 10.19);
});

// ===== the leg resets clean =====

test('rearmGridLeg clears the accumulators with the rest of the leg', () => {
  const obj = {
    BUY: [{ status: 'FILLED', orderId: 1, executedQty: 0.472, cummulativeQuoteQty: 271.11, filledQty: 0.1, filledQuote: 57 }],
    SELL: [{ status: 'FILLED', orderId: 2, executedQty: 0.472, cummulativeQuoteQty: 271.92, filledQty: 0.1, filledQuote: 58 }],
  };

  rearmGridLeg(obj, 0);

  // banked into gridRealized and flat again — a surviving accumulator would be
  // counted twice by every reader
  assert.equal(obj.BUY[0].filledQty, undefined);
  assert.equal(obj.BUY[0].filledQuote, undefined);
  assert.equal(slotQty(obj.SELL[0]), 0);
  assert.equal(slotQuote(obj.SELL[0]), 0);
});

// ===== configs written before the accumulators existed =====

test('a slot with no accumulators reads exactly as it always did', () => {
  const s = { status: 'FILLED', executedQty: 0.5, cummulativeQuoteQty: 290 };

  assert.equal(slotQty(s), 0.5);
  assert.equal(slotQuote(s), 290);
  assert.equal(cycleProfit({ BUY: [s], SELL: [] }), -290);
});
