const test = require('node:test');
const assert = require('node:assert/strict');
const { Job, Status } = require('../lib/job');

// ANALYSIS.md item 8 — the order state machine (the most money-critical logic) had
// no tests. Table-driven transition tests: for each pair state (entry[i], close[i])
// we check which API call Job decides to make and with what data.

const job = new Job(false);

const mkOrder = (side, status, over = {}) => ({
  status,
  symbol: 'BNBUSDT',
  side,
  type: 'LIMIT',
  quantity: '1.000',
  price: '100.00',
  timeInForce: 'GTC',
  orderId: null,
  ...over,
});

function mkObj({ buys = [], sells = [], param = {} } = {}) {
  return {
    status: Status.READY,
    pair: 'BNBUSDT',
    param: {
      'field-profit': '1',
      'field-commission': '0.1',
      'field-stepSize': '3',
      'field-tickSize': '2',
      ...param,
    },
    BUY: buys,
    SELL: sells,
  };
}

// ===== LONG: entry = BUY[i], close = SELL[i] =====

test('long: never placed (status null) → newOrder BUY with config qty/price', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', null, { quantity: '2.000', price: '95.00' })],
    sells: [mkOrder('SELL', null)],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.quantity, '2.000');
  assert.equal(r.data.price, '95.00');
});

test('long: BUY NEW → poll it via getOrder', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'NEW', { orderId: 11 })],
    sells: [mkOrder('SELL', null)],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.status, 'NEW');
  assert.equal(r.data.orderId, 11);
});

test('long: BUY PARTIALLY_FILLED → keep polling the BUY', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'PARTIALLY_FILLED', { orderId: 11 })],
    sells: [mkOrder('SELL', null)],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.status, 'PARTIALLY_FILLED');
});

test('long: BUY FILLED, SELL not placed → place the close (newOrder SELL)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 11 })],
    sells: [mkOrder('SELL', null, { quantity: '0.990', price: '102.00' })],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  // no partials → precomputed quantity/price from config
  assert.equal(r.data.quantity, '0.990');
  assert.equal(r.data.price, '102.00');
});

test('long: next BUY filled → stale lower SELL is canceled first', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 })],
    sells: [mkOrder('SELL', 'NEW', { orderId: 101 }), mkOrder('SELL', null)],
  });

  const r = job.long(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.id, 0);
  assert.equal(r.data.orderId, 101); // specifically the lower SELL
});

test('long: lower SELL already CANCELED → place close on the current index', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 })],
    sells: [
      mkOrder('SELL', 'CANCELED', { orderId: 101 }),
      mkOrder('SELL', null, { quantity: '1.980', price: '103.00' }),
    ],
  });

  const r = job.long(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.id, 1);
  assert.equal(r.data.quantity, '1.980');
});

test('long: close SELL is NEW → poll it', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 })],
    sells: [mkOrder('SELL', 'NEW', { orderId: 101 })],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.orderId, 101);
});

test('long: close SELL PARTIALLY_FILLED → poll it (early branch)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 })],
    sells: [mkOrder('SELL', 'PARTIALLY_FILLED', { orderId: 101 })],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.status, 'PARTIALLY_FILLED');
});

test('long: SELL CANCELED + higher BUY FILLED → pass (close delegated up)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 })],
    sells: [mkOrder('SELL', 'CANCELED', { orderId: 101 }), mkOrder('SELL', 'NEW', { orderId: 102 })],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.status, 'pass');
  assert.equal(r.method, false);
});

test('long: SELL CANCELED, higher BUY NOT filled → re-place the close (no stuck position)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'NEW', { orderId: 2 })],
    sells: [
      mkOrder('SELL', 'CANCELED', { orderId: 101, quantity: '0.990', price: '102.00' }),
      mkOrder('SELL', null),
    ],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.id, 0);
});

test('long: cycle complete (BUY FILLED + SELL FILLED) → DONE + cancelOpenOrders', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 101 })],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.status, Status.DONE);
  assert.equal(r.method, 'cancelOpenOrders');
});

test('long: partial close happened → re-placed close uses rebalanced quantity', () => {
  // BUY[0] filled 1.0 @ 100; the canceled SELL managed to sell 0.4.
  // Position leftover 0.6 — the new closing order must not sell 1.0.
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
    ],
    sells: [
      mkOrder('SELL', 'CANCELED', {
        orderId: 101,
        quantity: '1.000',
        price: '102.00',
        executedQty: 0.4,
        cummulativeQuoteQty: 41,
      }),
    ],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.quantity, '0.600'); // not the precomputed 1.000
});

// ===== SHORT: entry = SELL[i], close = BUY[i] (mirrored) =====

test('short: never placed → newOrder SELL', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', null)],
    sells: [mkOrder('SELL', null, { quantity: '1.000', price: '105.00' })],
  });

  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.price, '105.00');
});

test('short: SELL FILLED, BUY not placed → place the close (newOrder BUY)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', null, { quantity: '1.000', price: '98.00' })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 11 })],
  });

  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.price, '98.00');
});

test('short: next SELL filled → stale lower BUY is canceled first', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'NEW', { orderId: 201 }), mkOrder('BUY', null)],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 1 }), mkOrder('SELL', 'FILLED', { orderId: 2 })],
  });

  const r = job.short(obj, 1, obj.SELL[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.orderId, 201);
});

test('short: BUY CANCELED + higher SELL FILLED → pass (delegated up)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'CANCELED', { orderId: 201 }), mkOrder('BUY', 'NEW', { orderId: 202 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 1 }), mkOrder('SELL', 'FILLED', { orderId: 2 })],
  });

  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.status, 'pass');
});

test('short: BUY CANCELED, higher SELL NOT filled → re-place the close', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'CANCELED', { orderId: 201 }), mkOrder('BUY', null)],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 1 }), mkOrder('SELL', 'NEW', { orderId: 2 })],
  });

  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
});

test('short: cycle complete (SELL FILLED + BUY FILLED) → DONE + cancelOpenOrders', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 201 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 1 })],
  });

  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.status, Status.DONE);
  assert.equal(r.method, 'cancelOpenOrders');
});

test('long: active close lagging below i-1 (gap-fill) → cancel it before placing', () => {
  // Burst fill: buy[0..3] FILLED, the active close is stuck on SELL[1], the
  // intermediate SELL[2] is null. At the deep index 3 we must pull SELL[1] (not
  // only look at SELL[2]=null), otherwise it holds the balance → -2010.
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 }), mkOrder('BUY', 'FILLED', { orderId: 3 }), mkOrder('BUY', 'FILLED', { orderId: 4 })],
    sells: [mkOrder('SELL', 'CANCELED', { orderId: 101 }), mkOrder('SELL', 'NEW', { orderId: 102 }), mkOrder('SELL', null), mkOrder('SELL', null)],
  });

  const r = job.long(obj, 3, obj.BUY[3]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.id, 1); // specifically the stuck SELL[1], not SELL[2]
  assert.equal(r.data.orderId, 102);
});

// ===== orphan inventory after a "blind" window (Step 2) =====
// the sell slipped through between the drop and the bounce within one poll
// interval: the lower buys filled, but the close executed at the upper index
// before it crawled down. The cycle must not close, leaving an unsold position.

test('long: close filled but a deeper BUY is filled → pass, NOT done', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 }), mkOrder('BUY', 'FILLED', { orderId: 3 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 101 }), mkOrder('SELL', null), mkOrder('SELL', null)],
  });

  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.status, 'pass'); // not Status.DONE — a filled buy remains below
  assert.equal(r.method, false);
});

test('long: intermediate orphan index delegates close up → pass', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 }), mkOrder('BUY', 'FILLED', { orderId: 3 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 101 }), mkOrder('SELL', null), mkOrder('SELL', null)],
  });

  const r = job.long(obj, 1, obj.BUY[1]); // SELL[1] null, BUY[2] FILLED → delegate upward
  assert.equal(r.status, 'pass');
});

test('long: deepest orphan index re-places close on the remainder (no cancel(null) trap)', () => {
  // Bought 3.0 (3×1.0), the filled SELL[0] sold 1.0 → leftover 2.0.
  // The lower SELL[1]/SELL[2] were never placed (orderId null) — nothing to cancel.
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', { orderId: 2, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', { orderId: 3, executedQty: 1.0, cummulativeQuoteQty: 100 }),
    ],
    sells: [
      mkOrder('SELL', 'FILLED', { orderId: 101, executedQty: 1.0, cummulativeQuoteQty: 102 }),
      mkOrder('SELL', null),
      mkOrder('SELL', null),
    ],
  });

  const r = job.long(obj, 2, obj.BUY[2]);
  assert.equal(r.method, 'newOrder'); // not cancelOrder(null), not DONE
  assert.equal(r.side, 'SELL');
  assert.equal(r.id, 2);
  assert.equal(r.data.quantity, '2.000'); // position leftover, not the precompute
});

test('long: orphan remainder below minQty → DONE with leftover notice', () => {
  const jobMin = new Job(false);
  jobMin.minQty = 5; // leftover 2.0 < 5 → the close can't be placed
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', { orderId: 2, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', { orderId: 3, executedQty: 1.0, cummulativeQuoteQty: 100 }),
    ],
    sells: [
      mkOrder('SELL', 'FILLED', { orderId: 101, executedQty: 1.0, cummulativeQuoteQty: 102 }),
      mkOrder('SELL', null),
      mkOrder('SELL', null),
    ],
  });

  const r = jobMin.long(obj, 2, obj.BUY[2]);
  assert.equal(r.status, Status.DONE);
  assert.equal(r.method, 'cancelOpenOrders');
  assert.equal(r.leftover.quantity, '2.000');
});

test('short: close filled but a deeper SELL is filled → pass, NOT done', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 101 }), mkOrder('BUY', null), mkOrder('BUY', null)],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 1 }), mkOrder('SELL', 'FILLED', { orderId: 2 }), mkOrder('SELL', 'FILLED', { orderId: 3 })],
  });

  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.status, 'pass');
});

test('short: deepest orphan index re-buys the remainder (no cancel(null) trap)', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 101, executedQty: 1.0, cummulativeQuoteQty: 98 }),
      mkOrder('BUY', null),
      mkOrder('BUY', null),
    ],
    sells: [
      mkOrder('SELL', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('SELL', 'FILLED', { orderId: 2, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('SELL', 'FILLED', { orderId: 3, executedQty: 1.0, cummulativeQuoteQty: 100 }),
    ],
  });

  const r = job.short(obj, 2, obj.SELL[2]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.id, 2);
  assert.equal(r.data.quantity, '2.000');
});

// ===== test mode =====

test('test mode: both strategies always return pass (no API calls)', () => {
  const testJob = new Job(true);
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 })],
    sells: [mkOrder('SELL', null)],
  });

  assert.equal(testJob.long(obj, 0, obj.BUY[0]).status, 'pass');
  assert.equal(testJob.short(obj, 0, obj.SELL[0]).status, 'pass');
});

// ===== manual pull (Item 10): engine must NOT re-place a user-cancelled order =====
// A CANCELED order is normally treated as "re-place me". The `manual: true` flag
// (set by a manual single-order cancel) makes the engine leave it alone (pass).

test('long: manual-pulled BUY entry → pass, NOT re-placed', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'CANCELED', { manual: true, orderId: 11 })],
    sells: [mkOrder('SELL', null)],
  });
  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.status, 'pass');
  assert.equal(r.method, false);
});

test('control: CANCELED BUY entry without manual → re-placed (newOrder)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'CANCELED', { orderId: 11 })],
    sells: [mkOrder('SELL', null)],
  });
  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
});

test('long: manual-pulled SELL close (entry FILLED) → pass, NOT re-placed', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 })],
    sells: [mkOrder('SELL', 'CANCELED', { manual: true, orderId: 22 })],
  });
  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.status, 'pass');
  assert.equal(r.method, false);
});

test('control: CANCELED SELL close without manual (entry FILLED) → re-placed', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 })],
    sells: [mkOrder('SELL', 'CANCELED', { orderId: 22 })],
  });
  const r = job.long(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
});

test('short: manual-pulled SELL entry → pass, NOT re-placed', () => {
  const obj = mkObj({
    sells: [mkOrder('SELL', 'CANCELED', { manual: true, orderId: 33 })],
    buys: [mkOrder('BUY', null)],
  });
  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.status, 'pass');
  assert.equal(r.method, false);
});

test('short: manual-pulled BUY close (entry FILLED) → pass, NOT re-placed', () => {
  const obj = mkObj({
    sells: [mkOrder('SELL', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 })],
    buys: [mkOrder('BUY', 'CANCELED', { manual: true, orderId: 44 })],
  });
  const r = job.short(obj, 0, obj.SELL[0]);
  assert.equal(r.status, 'pass');
  assert.equal(r.method, false);
});
