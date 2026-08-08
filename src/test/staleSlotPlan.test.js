const test = require('node:test');
const assert = require('node:assert/strict');
const { Job, Status } = require('../lib/job');

// When rebalancedClose finds no partial fills to net out it bows out, and the
// classic close falls back to the plan sitting on the slot. That plan is the
// calculator's — until the scalp overwrites price/qty with its own rung-sized
// numbers, which outlive the micro that wrote them.
//
// Live incident: the hybrid was switched off, so the engine pulled the micro and
// the tail and handed the rung back to the classic machine. rebalancedClose saw a
// clean book (the micro was pulled unfilled, the banked legs had been wiped by
// rearmGridLeg) and returned null, so the close inherited the micro's leftovers —
// one rung, 0.096, against 0.363 actually held. The position stayed a quarter
// covered for three days, until that close filled and ended the cycle.
//
// #fullClose does not bail out on a clean book, so it is asked first now; the slot
// plan is the last resort, for configs too old to carry fill data.

const mk = (side, status, over = {}) => ({
  status,
  symbol: 'BNBUSDT',
  side,
  type: 'LIMIT',
  quantity: '0.023',
  price: '631.63',
  timeInForce: 'GTC',
  orderId: null,
  ...over,
});

const FILLS = [
  ['0.023', '631.63', 0.023, 14.51852],
  ['0.029', '630.68', 0.029, 18.28972],
  ['0.036', '628.79', 0.036, 22.63644],
  ['0.046', '625.96', 0.046, 28.79416],
  ['0.058', '621.26', 0.058, 36.03308],
  ['0.075', '613.81', 0.075, 46.03575],
  ['0.096', '601.84', 0.096, 57.77664],
];

// The books the moment the scalp handed rung #7 back: seven filled buys (0.363),
// the tail pulled unfilled, and the micro's rung-sized numbers left on the slot.
function handedBack({ entryFills = true } = {}) {
  return {
    status: Status.STARTED,
    pair: 'BNBUSDT',
    param: {
      'field-profit': '0.7',
      'field-commission': '0.25',
      'field-stepSize': '3',
      'field-tickSize': '2',
    },
    BUY: FILLS.map(([quantity, price, executedQty, cummulativeQuoteQty]) =>
      mk(
        'BUY',
        'FILLED',
        entryFills ? { quantity, price, executedQty, cummulativeQuoteQty } : { quantity, price }
      )
    ),
    SELL: [
      ...Array.from({ length: 5 }, () =>
        mk('SELL', 'CANCELED', { executedQty: 0, cummulativeQuoteQty: 0 })
      ),
      // the pulled tail
      mk('SELL', 'CANCELED', {
        quantity: '0.267',
        price: '614.78',
        executedQty: 0,
        cummulativeQuoteQty: 0,
      }),
      // the pulled micro: its rung-sized plan is what the slot still carries
      mk('SELL', 'CANCELED', {
        quantity: '0.096',
        price: '606.35',
        executedQty: 0,
        cummulativeQuoteQty: 0,
      }),
    ],
    gridRealized: 3.705449999999999,
  };
}

test('long: the close taking the rung back covers the position, not the rung', () => {
  const job = new Job(false);
  const obj = handedBack();

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.equal(res.method, 'newOrder');
  assert.equal(res.side, 'SELL');
  assert.notEqual(res.data.quantity, '0.096', 'must not inherit the micro plan');
  // everything held, priced off the real fills with the 3.705 bank folded in
  assert.equal(res.data.quantity, '0.363');
  assert.equal(res.data.price, '612.87');
});

test('long: a config without fill data still uses the slot plan', () => {
  const job = new Job(false);
  const obj = handedBack({ entryFills: false });

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.equal(res.method, 'newOrder');
  assert.equal(res.data.quantity, '0.096');
  assert.equal(res.data.price, '606.35');
});

test('long: a stale plan below the exchange minimum no longer ends the cycle', () => {
  const job = new Job(false);
  job.minNotional = 100; // 0.096 × 606.35 ≈ 58 would trip it; 0.363 × 612.87 ≈ 222 does not
  const obj = handedBack();

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.notEqual(res.status, Status.DONE);
  assert.equal(res.data.quantity, '0.363');
});

test('short: mirrored — the close covers the position, not the rung', () => {
  const job = new Job(false);
  const obj = handedBack();
  const mirrored = {
    ...obj,
    SELL: obj.BUY.map((o) => ({ ...o, side: 'SELL' })),
    BUY: obj.SELL.map((o) => ({ ...o, side: 'BUY' })),
  };

  const res = job.short(mirrored, 6, mirrored.SELL[6]);

  assert.equal(res.method, 'newOrder');
  assert.equal(res.side, 'BUY');
  assert.notEqual(res.data.quantity, '0.096');
  assert.equal(res.data.quantity, '0.363');
});
