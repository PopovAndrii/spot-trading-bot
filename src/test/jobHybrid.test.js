const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Job,
  Status,
  gridLegProfit,
  rearmGridLeg,
  bankGridLeg,
  entryFillPrice,
} = require('../lib/job');

// Hybrid DCA/GRID v3: the classic DCA machine runs UNCHANGED over the whole
// ladder; the hybrid only swaps the resting close of the DEEPEST held grid rung
// for a micro take-profit while the live price sits below the field-gridExit
// split (long; short mirrored). Micro fill → REARM (bank + re-arm the rung).
// These tests pin: pure delegation to classic, the scalp gate (price vs split,
// micro-cap), the yield transitions in both directions, and the re-arm helpers.

const job = new Job(false); // price = null → scalp always off

function priceJob(price) {
  const j = new Job(false);
  j.price = price;
  return j;
}

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

// Standard scalp fixture (long): base rung 0 filled 1.0 @ 100, deepest grid
// rung 1 filled 1.0 @ 90 (gridLevel=2 → g=1, D=1). Fees 0.4 (profit 0.2 +
// commission 0.2) → the whole-position close is recomputed from the fills:
// 2.000 @ avg(95) × 1.004 = 95.38 (the slot plan holds the same numbers).
//   split(50%) = (90 + 95.38) / 2 = 92.69
//   micro      = 90 × (1 + (0.1 + 0.2)/100) = 90.27  (< split → cap ok)
function scalpObj(over = {}) {
  return mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', {
        orderId: 2,
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        price: '90.00',
      }),
    ],
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', null, { quantity: '2.000', price: '95.38' }),
    ],
    param: { 'field-gridLevel': '2', 'field-profit': '0.2', 'field-commission': '0.2' },
    ...over,
  });
}

// ===== pure delegation: everything but the scalp is byte-identical classic DCA =====

test('hybrid: invalid/missing gridLevel → identical to pure DCA on every index', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { orderId: 1 }), mkOrder('BUY', 'NEW', { orderId: 2 })],
    sells: [mkOrder('SELL', null, { quantity: '0.99', price: '102.00' }), mkOrder('SELL', null)],
    // no field-gridLevel
  });
  for (const i of [0, 1]) {
    assert.deepEqual(job.hybridLong(obj, i, obj.BUY[i]), job.long(obj, i, obj.BUY[i]));
  }
});

test('hybrid: unknown price → identical to pure DCA (full close rests, no scalp)', () => {
  const obj = scalpObj();
  for (const i of [0, 1]) {
    assert.deepEqual(job.hybridLong(obj, i, obj.BUY[i]), job.long(obj, i, obj.BUY[i]));
  }
  // and the deepest rung places the WHOLE-position plan close
  const r = job.hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.quantity, '2.000');
  assert.equal(r.data.price, '95.38');
});

test('hybrid: deepest fill still in the DCA base (D < gridStart) → classic everywhere', () => {
  const obj = scalpObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'NEW', { orderId: 2, price: '90.00' }),
    ],
  });
  const j = priceJob(95); // price known, but no grid rung is held
  for (const i of [0, 1]) {
    assert.deepEqual(j.hybridLong(obj, i, obj.BUY[i]), j.long(obj, i, obj.BUY[i]));
  }
});

test('hybrid: non-deepest indices delegate to classic even while the scalp is on', () => {
  const obj = scalpObj();
  const j = priceJob(91); // 91 < 92.69 → scalp zone for rung 1
  assert.deepEqual(j.hybridLong(obj, 0, obj.BUY[0]), j.long(obj, 0, obj.BUY[0]));
});

test('hybrid: ladder below the deepest fill keeps arming entries (buys follow the price down)', () => {
  const obj = scalpObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', {
        orderId: 2,
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        price: '90.00',
      }),
      mkOrder('BUY', null, { quantity: '4.000', price: '80.00' }),
    ],
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', null, { quantity: '2.000', price: '95.38' }),
      mkOrder('SELL', null, { quantity: '6.000', price: '88.00' }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 2, obj.BUY[2]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.price, '80.00'); // safety entry keeps resting deeper
});

// ===== the scalp gate: price vs split, micro-cap =====

test('scalp: P below the split → micro SELL of ONLY the deepest rung volume (role micro)', () => {
  const obj = scalpObj();
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]); // 91 < 92.69
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.role, 'micro');
  assert.equal(r.data.quantity, '1.000'); // rung's own fill, not the 2.000 plan
  assert.equal(r.data.price, '90.27'); // 90 × 1.003
});

test('scalp: P at/above the split → classic whole-position close', () => {
  const obj = scalpObj();
  const r = priceJob(93).hybridLong(obj, 1, obj.BUY[1]); // 93 ≥ 92.69
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.role, undefined);
  assert.equal(r.data.quantity, '2.000');
  assert.equal(r.data.price, '95.38');
});

test('scalp: gridExit=0 → split at the entry, micro would cross it → no scalp at all', () => {
  const obj = scalpObj({
    param: { 'field-gridLevel': '2', 'field-gridExit': '0' }, // split = 90
  });
  const r = priceJob(89).hybridLong(obj, 1, obj.BUY[1]); // P < split is impossible to scalp:
  assert.equal(r.role, undefined); // micro 90.27 ≥ 90 → capped out → classic close
  assert.equal(r.data.quantity, '2.000');
});

test('scalp: empty-string gridExit (broken SpinBox restore) falls back to 50', () => {
  const obj = scalpObj({
    param: { 'field-gridLevel': '2', 'field-gridExit': '' },
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]); // split stays 92.69
  assert.equal(r.role, 'micro');
});

// ===== yield transitions =====

test('yield: scalp on + resting full close → cancel it (micro takes the slot)', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 300, quantity: '2.000', price: '95.38' }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 300);
});

test('yield: scalp on + resting micro → keep polling it (no churn)', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 301, role: 'micro', quantity: '1.000', price: '90.18' }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.data.orderId, 301);
});

test('yield: price crossed the split with a resting micro → cancel it (full close returns)', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 302, role: 'micro', quantity: '1.000', price: '90.18' }),
    ],
  });
  const r = priceJob(93).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 302);
});

test('yield: scalp off + resting full close → classic keeps polling it', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 303, quantity: '2.000', price: '95.38' }),
    ],
  });
  const r = priceJob(93).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'getOrder');
  assert.equal(r.data.orderId, 303);
});

test('yield: manual-pulled close in the scalp zone → pass (user decision wins)', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'CANCELED', { orderId: 304, manual: true }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.status, 'pass');
});

// ===== banked oscillation (REARM) =====

test('REARM: entry FILLED + micro FILLED → banked, regardless of the current price', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'FILLED', {
        orderId: 305,
        role: 'micro',
        executedQty: 1.0,
        cummulativeQuoteQty: 90.18,
      }),
    ],
  });
  for (const j of [priceJob(91), priceJob(93), job]) {
    const r = j.hybridLong(obj, 1, obj.BUY[1]);
    assert.equal(r.status, 'REARM');
    assert.equal(r.method, false);
    assert.equal(r.id, 1);
  }
});

test('no REARM: the FULL close filled (no micro role) → classic DONE path', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'FILLED', { orderId: 306, executedQty: 2.0, cummulativeQuoteQty: 190.76 }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.status, Status.DONE);
  assert.equal(r.method, 'cancelOpenOrders');
});

test('canceled partial predecessor on the slot: micro re-placed for the remainder only', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'CANCELED', { orderId: 307, role: 'micro', executedQty: 0.4 }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, 'micro');
  assert.equal(r.data.quantity, '0.600'); // 1.0 filled − 0.4 already sold
});

test('canceled predecessor already closed the whole rung → REARM (banked de-facto)', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'CANCELED', { orderId: 308, role: 'micro', executedQty: 1.0 }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.status, 'REARM');
});

// ===== short mirror =====

// Short fixture: base rung 0 sold 1.0 @ 100, deepest grid rung 1 sold 1.0 @ 110
// (price rose). Fees 0.4 → whole buy-back recomputed from fills:
// 2.000 @ avg(105) × 0.996 = 104.58. gridLevel=2.
//   split(50%) = (110 + 104.58) / 2 = 107.29
//   micro      = 110 × (1 − 0.003)  = 109.67  (> split → cap ok)
function scalpShortObj(over = {}) {
  return mkObj({
    buys: [
      mkOrder('BUY', null),
      mkOrder('BUY', null, { quantity: '2.000', price: '104.58' }),
    ],
    sells: [
      mkOrder('SELL', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('SELL', 'FILLED', {
        orderId: 2,
        executedQty: 1.0,
        cummulativeQuoteQty: 110,
        price: '110.00',
      }),
    ],
    param: { 'field-gridLevel': '2', 'field-profit': '0.2', 'field-commission': '0.2' },
    ...over,
  });
}

test('short scalp: P above the split → micro BUY-back of the deepest rung volume', () => {
  const obj = scalpShortObj();
  const r = priceJob(108).hybridShort(obj, 1, obj.SELL[1]); // 108 > 107.29
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.role, 'micro');
  assert.equal(r.data.quantity, '1.000');
  assert.equal(r.data.price, '109.67'); // 110 × 0.997
});

test('short scalp: P at/below the split → classic whole buy-back', () => {
  const obj = scalpShortObj();
  const r = priceJob(105).hybridShort(obj, 1, obj.SELL[1]); // 105 ≤ 107.29
  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, undefined);
  assert.equal(r.data.quantity, '2.000');
  assert.equal(r.data.price, '104.58');
});

test('short: unknown price → identical to pure DCA', () => {
  const obj = scalpShortObj();
  for (const i of [0, 1]) {
    assert.deepEqual(job.hybridShort(obj, i, obj.SELL[i]), job.short(obj, i, obj.SELL[i]));
  }
});

// ===== helpers =====

test('entryFillPrice: real fill average wins over the slot price', () => {
  assert.equal(entryFillPrice({ executedQty: 2, cummulativeQuoteQty: 181, price: '95.00' }), 90.5);
  assert.equal(entryFillPrice({ price: '95.00' }), 95); // fallback to the resting price
  assert.equal(entryFillPrice({}), null);
  assert.equal(entryFillPrice(null), null);
});

test('bankGridLeg (long): folds profit, bumps the per-rung counter on the SELL close, re-arms', () => {
  const obj = mkObj({
    buys: [mkOrder('BUY', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 90.0 })],
    sells: [
      mkOrder('SELL', 'FILLED', { role: 'micro', executedQty: 1.0, cummulativeQuoteQty: 90.27 }),
    ],
  });
  const banked = bankGridLeg(obj, 0, 'long');
  assert.equal(Number(banked.toFixed(4)), 0.27);
  assert.equal(Number(obj.gridRealized.toFixed(4)), 0.27);
  assert.equal(obj.SELL[0].hybrid, 1); // ×N counter on the close order
  assert.equal(obj.BUY[0].status, null); // re-armed
  assert.equal(obj.SELL[0].status, null);
  assert.equal(obj.SELL[0].executedQty, undefined);
  assert.equal(obj.SELL[0].role, undefined);
});

test('bankGridLeg (short): counter lives on the BUY close order', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { role: 'micro', executedQty: 1.0, cummulativeQuoteQty: 109.78 }),
    ],
    sells: [mkOrder('SELL', 'FILLED', { executedQty: 1.0, cummulativeQuoteQty: 110.0 })],
  });
  const banked = bankGridLeg(obj, 0, 'short');
  assert.equal(Number(banked.toFixed(4)), 0.22);
  assert.equal(obj.BUY[0].hybrid, 1);
});

test('gridLegProfit: sell quote − buy quote (both sides use the same formula)', () => {
  const buy = { cummulativeQuoteQty: 90.0 };
  const sell = { cummulativeQuoteQty: 90.3 };
  assert.equal(Number(gridLegProfit(buy, sell).toFixed(4)), 0.3);
});

test('gridLegProfit: missing fills → 0', () => {
  assert.equal(gridLegProfit({}, {}), 0);
  assert.equal(gridLegProfit(null, null), 0);
});

test('rearmGridLeg: resets status/orderId/fills/role, keeps qty & price', () => {
  const obj = mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', {
        orderId: 9,
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        manual: true,
      }),
    ],
    sells: [
      mkOrder('SELL', 'FILLED', {
        orderId: 10,
        role: 'micro',
        executedQty: 1.0,
        cummulativeQuoteQty: 90.27,
        hybrid: 3,
      }),
    ],
  });
  rearmGridLeg(obj, 0);
  for (const side of ['BUY', 'SELL']) {
    assert.equal(obj[side][0].status, null);
    assert.equal(obj[side][0].orderId, null);
    assert.equal(obj[side][0].executedQty, undefined);
    assert.equal(obj[side][0].manual, undefined);
    assert.equal(obj[side][0].role, undefined);
  }
  assert.equal(obj.SELL[0].hybrid, 3); // ×N counter survives the re-arm
  assert.equal(obj.BUY[0].quantity, '1.000');
  assert.equal(obj.SELL[0].price, '100.00');
});
