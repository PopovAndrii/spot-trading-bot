const test = require('node:test');
const assert = require('node:assert/strict');
const { Job, Status } = require('../lib/job');

// A FILLED close at the deepest filled entry index used to end the cycle on the
// index alone. But a close sized for ONE RUNG fills at that index too — that is
// what a hybrid micro is, and once its 'role' marker is gone the classic machine
// cannot tell it from the whole-position close.
//
// How the marker goes missing, seen live: the arm is raised past the carrying
// rung, so it falls out of the scalp zone and the engine moves to pull its resting
// micro. The price fills that micro first; the swap then places a classic close,
// which deletes the marker on its way out and is itself rejected — the base it was
// sized for has just been sold. The slot is left FILLED, rung-sized and roleless,
// and the next tick reads it as the whole-position close: DONE, cancelOpenOrders
// takes the tail with it, and the rest of the ladder sits on the balance with
// nothing on the book.
//
// These pin the fix: the books decide, not the index.

const mk = (side, status, over = {}) => ({
  status,
  symbol: 'BNBUSDT',
  side,
  type: 'LIMIT',
  quantity: '0.023',
  price: '631.63',
  timeInForce: 'GTC',
  orderId: 1,
  ...over,
});

// The seven filled BUY rungs of the incident, verbatim.
const FILLS = [
  ['0.023', '631.63', 0.023, 14.51852],
  ['0.029', '630.68', 0.029, 18.28972],
  ['0.036', '628.79', 0.036, 22.63644],
  ['0.046', '625.96', 0.046, 28.79416],
  ['0.058', '621.26', 0.058, 36.03308],
  ['0.075', '613.81', 0.075, 46.03575],
  ['0.096', '601.84', 0.096, 57.77664],
];

function liveObj({ closeQty = 0.096, closeQuote = 58.2096 } = {}) {
  return {
    status: Status.STARTED,
    pair: 'BNBUSDT',
    param: {
      'field-profit': '0.7',
      'field-commission': '0.25',
      'field-stepSize': '3',
      'field-tickSize': '2',
      'field-gridArm': '8',
    },
    BUY: FILLS.map(([quantity, price, executedQty, cummulativeQuoteQty]) =>
      mk('BUY', 'FILLED', { quantity, price, executedQty, cummulativeQuoteQty })
    ),
    // Only the close on the deepest rung ever filled; the tail above it was pulled.
    SELL: [
      ...Array.from({ length: 5 }, () =>
        mk('SELL', 'CANCELED', { executedQty: 0, cummulativeQuoteQty: 0 })
      ),
      mk('SELL', 'CANCELED', {
        quantity: '0.267',
        price: '614.78',
        role: 'tail',
        executedQty: 0,
        cummulativeQuoteQty: 0,
      }),
      // the ex-micro: rung-sized, role already deleted
      mk('SELL', 'FILLED', {
        quantity: String(closeQty),
        price: '606.35',
        executedQty: closeQty,
        cummulativeQuoteQty: closeQuote,
      }),
    ],
    gridRealized: 3.705449999999999,
  };
}

test('long: a rung-sized close does not end the cycle — the leftover is re-closed', () => {
  const job = new Job(false);
  const obj = liveObj();

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.notEqual(res.status, Status.DONE, 'cycle must not end while 0.267 is held');
  assert.equal(res.method, 'newOrder');
  assert.equal(res.side, 'SELL');
  assert.equal(res.id, 6);
  // 0.363 bought − 0.096 already sold, priced off the remaining fills with the
  // 3.705 bank folded in — the same numbers the UI badge shows.
  assert.equal(res.data.quantity, '0.267');
  assert.equal(res.data.price, '613.15');
});

test('long: the whole-position close still ends the cycle', () => {
  const job = new Job(false);
  // this close sold everything the ladder held
  const obj = liveObj({ closeQty: 0.363, closeQuote: 224.9 });

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.equal(res.status, Status.DONE);
  assert.equal(res.method, 'cancelOpenOrders');
  assert.equal(res.leftover, undefined);
});

test('long: a leftover under the exchange minimum ends the cycle as dust', () => {
  const job = new Job(false);
  job.minNotional = 500; // 0.267 × 613.15 ≈ 164 → below
  const obj = liveObj();

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.equal(res.status, Status.DONE);
  assert.equal(res.method, 'cancelOpenOrders');
  assert.equal(res.leftover.quantity, '0.267');
  assert.equal(res.leftover.symbol, 'BNBUSDT');
});

test('long: an orphan below the filled close still yields to the lower index', () => {
  const job = new Job(false);
  const obj = liveObj();

  // a filled buy deeper than the close → the old guard, untouched
  const res = job.long(obj, 5, obj.BUY[5]);

  assert.equal(res.status, 'pass');
  assert.equal(res.method, false);
});

test('long: a config without fill data ends the cycle as it always did', () => {
  const job = new Job(false);
  const obj = liveObj();
  for (const b of obj.BUY) delete b.executedQty;

  const res = job.long(obj, 6, obj.BUY[6]);

  assert.equal(res.status, Status.DONE);
  assert.equal(res.method, 'cancelOpenOrders');
});

test('short: mirrored — a rung-sized close does not end the cycle', () => {
  const job = new Job(false);
  const obj = liveObj();
  // mirror the ladder: the position is built with SELL, closed with BUY
  const mirrored = {
    ...obj,
    SELL: obj.BUY.map((o) => ({ ...o, side: 'SELL' })),
    BUY: obj.SELL.map((o) => ({ ...o, side: 'BUY' })),
  };

  const res = job.short(mirrored, 6, mirrored.SELL[6]);

  assert.notEqual(res.status, Status.DONE, 'cycle must not end while 0.267 is held');
  assert.equal(res.method, 'newOrder');
  assert.equal(res.side, 'BUY');
  assert.equal(res.data.quantity, '0.267');
});
