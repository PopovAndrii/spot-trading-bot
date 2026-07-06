const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Job,
  Status,
  gridLegProfit,
  rearmGridLeg,
  frontierIndex,
  averagedClosePrice,
} = require('../lib/job');

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

// ===== v2 pure helpers: frontier + averaged close =====

test('frontierIndex: deepest FILLED entry at/below gridStart is the frontier', () => {
  const entries = [
    mkOrder('BUY', 'FILLED'),
    mkOrder('BUY', 'FILLED'),
    mkOrder('BUY', 'FILLED'),
    mkOrder('BUY', 'NEW'),
  ];
  assert.equal(frontierIndex(entries, 2), 2); // rung #3 held → F = 2
  assert.equal(frontierIndex(entries, 1), 2); // deepest fill wins, not gridStart itself
});

test('frontierIndex: no grid rung held → -1 (degrade to classic DCA)', () => {
  const baseOnly = [mkOrder('BUY', 'FILLED'), mkOrder('BUY', 'NEW'), mkOrder('BUY', null)];
  assert.equal(frontierIndex(baseOnly, 2), -1); // deepest fill (0) is in the DCA base
  assert.equal(frontierIndex([], 0), -1);
  assert.equal(frontierIndex(null, 0), -1);
});

test('frontierIndex: walks up after a re-arm (deepest fill drops to a shallower rung)', () => {
  const entries = [
    mkOrder('BUY', 'FILLED'),
    mkOrder('BUY', 'FILLED'),
    mkOrder('BUY', null), // rung 2 just re-armed — its micro banked
  ];
  assert.equal(frontierIndex(entries, 1), 1);
});

test('averagedClosePrice (long): (Σquote/Σqty) × (1 + fees/100) over FILLED entries 0..upTo', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 90 }),
      mkOrder('BUY', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 80 }),
    ],
  });
  // S over 0..1: avg 95 × 1.004 (profit 0.2 + commission 0.2)
  assert.equal(averagedClosePrice(obj, 1, 'long', 0.4), 95.38);
  // S over 0..2: avg 90 × 1.004 — deeper rung pulls the close DOWN
  assert.equal(averagedClosePrice(obj, 2, 'long', 0.4), 90.36);
});

test('averagedClosePrice (short): mirror, avg × (1 − fees/100), SELL side', () => {
  const obj = mkObj({
    sells: [
      mkOrder('SELL', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('SELL', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 90 }),
    ],
  });
  assert.equal(averagedClosePrice(obj, 1, 'short', 0.4), 94.62); // 95 × 0.996
});

test('averagedClosePrice: skips non-FILLED and entries without fill data', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'NEW', { executedQty: 0.5, cummulativeQuoteQty: 45 }), // not filled
      mkOrder('BUY', 'FILLED'), // old config: no fill fields
    ],
  });
  assert.equal(averagedClosePrice(obj, 2, 'long', 0.4), 100.4); // only rung 0 counts
});

test('averagedClosePrice: nothing filled in range → null (S_{F-1} at the first rung)', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 100 })],
  });
  assert.equal(averagedClosePrice(obj, -1, 'long', 0.4), null); // upTo before the start
  assert.equal(averagedClosePrice(mkObj(), 3, 'long', 0.4), null); // empty ladder
});
