const test = require('node:test');
const assert = require('node:assert/strict');
const { Job, Status, gridLegProfit, rearmGridLeg } = require('../lib/job');

// Hybrid DCA/GRID state machine. Rungs 0..N-1 (N = field-gridLevel, a 1-based
// order number) are pure DCA — evaluated by the existing long()/short() over a
// base-only VIEW. Rungs N..deep are independent grid legs (own micro take-profit,
// re-arm on close). These tests pin the dispatch boundary, the grid-leg
// transitions, the base/grid isolation, and the re-arm helpers.

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

// ===== dispatch boundary: order N (1-based) is the first grid rung =====

test('hybrid: invalid/missing gridLevel → identical to pure DCA', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'NEW', { orderId: 2 })],
    sells: [mkOrder('SELL', null, { quantity: '0.99', price: '102.00' }), mkOrder('SELL', null)],
    // no field-gridLevel
  });
  for (const i of [0, 1]) {
    assert.deepEqual(job.hybridLong(obj, i, obj.BUY[i]), job.long(obj, i, obj.BUY[i]));
  }
});

test('hybrid: gridLevel=3 → rungs 0,1 are DCA base; rung 2 is a grid leg', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1 }),
      mkOrder('BUY', 'FILLED', { orderId: 2 }),
      mkOrder('BUY', null, { quantity: '4.000', price: '90.00' }),
    ],
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', null),
      mkOrder('SELL', null, { quantity: '4.000', price: '90.27' }),
    ],
    param: { 'field-gridLevel': '3' },
  });

  // base rung 1 matches the DCA decision over the base view (rungs 0..1)
  const view = { ...obj, BUY: obj.BUY.slice(0, 2), SELL: obj.SELL.slice(0, 2) };
  assert.deepEqual(job.hybridLong(obj, 1, obj.BUY[1]), job.long(view, 1, obj.BUY[1]));

  // grid rung 2: entry not placed → arm the BUY at its own qty/price
  const r = job.hybridLong(obj, 2, obj.BUY[2]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.quantity, '4.000');
  assert.equal(r.data.price, '90.00');
});

// ===== grid leg transitions (long: entry=BUY, close=SELL) =====

function gridObj(over = {}) {
  // gridLevel=1 → every rung is a grid leg (start index 0)
  return mkObj({
    buys: [mkOrder('BUY', null, { quantity: '1.000', price: '90.00' })],
    sells: [mkOrder('SELL', null, { quantity: '1.000', price: '90.27' })],
    param: { 'field-gridLevel': '1' },
    ...over,
  });
}

test('grid long: entry null → place the BUY (arm the leg)', () => {
  const obj = gridObj();
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.price, '90.00');
});

test('grid long: entry NEW → poll the BUY', () => {
  const obj = gridObj({ buys: [mkOrder('BUY', 'NEW', { orderId: 5 })] });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.orderId, 5);
});

test('grid long: entry FILLED, close not placed → place the micro take-profit SELL', () => {
  // micro price = entry level × (1 + (microProfit + commission)/100), computed by
  // the engine from the fill — not the stale close slot. Here 90.00 × 1.002 = 90.18
  // (microProfit default 0.1 + commission 0.1). Qty = the entry's filled amount.
  const obj = gridObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 5, quantity: '1.000', price: '90.00' })],
    sells: [mkOrder('SELL', null, { quantity: '9.999', price: '999.99' })], // ignored
  });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.price, '90.18');
  assert.equal(r.data.quantity, '1.000');
});

test('grid long: close NEW → poll the SELL', () => {
  const obj = gridObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 5 })],
    sells: [mkOrder('SELL', 'NEW', { orderId: 6 })],
  });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.orderId, 6);
});

test('grid long: entry FILLED + close FILLED → REARM (one oscillation banked)', () => {
  const obj = gridObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 5 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 6 })],
  });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.status, 'REARM');
  assert.equal(r.method, false);
  assert.equal(r.id, 0);
});

test('grid long: manual-pulled entry → pass (leave it alone)', () => {
  const obj = gridObj({ buys: [mkOrder('BUY', 'CANCELED', { manual: true, orderId: 5 })] });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.status, 'pass');
  assert.equal(r.method, false);
});

// ===== base/grid isolation: a filled grid rung must NOT block the base close =====

test('hybrid: base close completes (DONE) even though a deeper grid rung is FILLED', () => {
  // gridLevel=2 → base is only rung 0. Rung 1 is a grid leg whose BUY is FILLED.
  // Over the whole array deepestFilledIndex(BUY)=1 > 0 would wrongly force a pass;
  // the base view (rungs 0..1 sliced to base) sees only rung 0 → DONE is correct.
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'FILLED', { orderId: 2 })],
    sells: [mkOrder('SELL', 'FILLED', { orderId: 101 }), mkOrder('SELL', 'NEW', { orderId: 102 })],
    param: { 'field-gridLevel': '2' },
  });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.status, Status.DONE);
  assert.equal(r.method, 'cancelOpenOrders');
});

test('hybrid: grid micro-close does NOT leak into the base rebalance', () => {
  // gridLevel=2. Base rung 0 bought 1.0 @100; its averaged close SELL[0] was
  // canceled after selling nothing. Grid rung 1 sold 1.0 (a banked leg). The base
  // re-placed close must reflect only rung 0 (qty 1.000), not subtract the grid sell.
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', { orderId: 2, executedQty: 1.0, cummulativeQuoteQty: 90 }),
    ],
    sells: [
      mkOrder('SELL', 'CANCELED', { orderId: 101, executedQty: 0, cummulativeQuoteQty: 0 }),
      mkOrder('SELL', 'FILLED', { orderId: 102, executedQty: 1.0, cummulativeQuoteQty: 90.3 }),
    ],
    param: { 'field-gridLevel': '2' },
  });
  const r = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.quantity, '1.000'); // rung 0 only; grid rung 1's sell excluded
});

// ===== short mirror =====

test('grid short: entry (SELL) FILLED, close not placed → place the micro BUY-back', () => {
  // mirror: micro buy-back = entry level × (1 − 0.2/100). 100.00 × 0.998 = 99.80.
  const obj = mkObj({
    sells: [mkOrder('SELL', 'FILLED', { orderId: 5, quantity: '1.000', price: '100.00' })],
    buys: [mkOrder('BUY', null, { quantity: '9.999', price: '999.99' })], // ignored
    param: { 'field-gridLevel': '1' },
  });
  const r = job.hybridShort(obj, 0, obj.SELL[0]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.price, '99.80');
  assert.equal(r.data.quantity, '1.000');
});

test('grid short: entry FILLED + close FILLED → REARM', () => {
  const obj = mkObj({
    sells: [mkOrder('SELL', 'FILLED', { orderId: 5 })],
    buys: [mkOrder('BUY', 'FILLED', { orderId: 6 })],
    param: { 'field-gridLevel': '1' },
  });
  const r = job.hybridShort(obj, 0, obj.SELL[0]);
  assert.equal(r.status, 'REARM');
});

// ===== test mode short-circuits hybrid too =====

test('hybrid: test mode → pass for both strategies', () => {
  const testJob = new Job(true);
  const obj = gridObj({ buys: [mkOrder('BUY', 'FILLED', { orderId: 5 })] });
  assert.equal(testJob.hybridLong(obj, 0, obj.BUY[0]).status, 'pass');
  assert.equal(testJob.hybridShort(obj, 0, obj.SELL[0]).status, 'pass');
});

// ===== pure re-arm helpers =====

test('gridLegProfit: sell quote − buy quote (both sides use the same formula)', () => {
  const buy = { cummulativeQuoteQty: 100 };
  const sell = { cummulativeQuoteQty: 100.3 };
  assert.equal(Number(gridLegProfit(buy, sell).toFixed(4)), 0.3);
});

test('gridLegProfit: missing fills → 0', () => {
  assert.equal(gridLegProfit({}, {}), 0);
  assert.equal(gridLegProfit(null, null), 0);
});

test('rearmGridLeg: resets status/orderId/fills, keeps qty & price', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', {
        orderId: 5,
        quantity: '1.000',
        price: '90.00',
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        manual: true,
      }),
    ],
    sells: [
      mkOrder('SELL', 'FILLED', {
        orderId: 6,
        quantity: '1.000',
        price: '90.27',
        executedQty: 1.0,
        cummulativeQuoteQty: 90.3,
      }),
    ],
  });
  rearmGridLeg(obj, 0);
  for (const side of ['BUY', 'SELL']) {
    const s = obj[side][0];
    assert.equal(s.status, null);
    assert.equal(s.orderId, null);
    assert.ok(!('executedQty' in s));
    assert.ok(!('cummulativeQuoteQty' in s));
    assert.ok(!('manual' in s));
  }
  assert.equal(obj.BUY[0].quantity, '1.000');
  assert.equal(obj.BUY[0].price, '90.00');
  assert.equal(obj.SELL[0].price, '90.27'); // micro price preserved for the next leg
});
