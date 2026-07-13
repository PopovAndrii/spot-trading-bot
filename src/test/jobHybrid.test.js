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
    sells: [mkOrder('SELL', null), mkOrder('SELL', null, { quantity: '2.000', price: '95.38' })],
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
  const j = priceJob(90); // 90 < micro 90.27 → the scalp can arm
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
  const r = priceJob(90).hybridLong(obj, 2, obj.BUY[2]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.side, 'BUY');
  assert.equal(r.data.price, '80.00'); // safety entry keeps resting deeper
});

// ===== the scalp gate: price vs split, micro-cap =====

test('scalp: P below the split → micro SELL of ONLY the deepest rung volume (role micro)', () => {
  const obj = scalpObj();
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]); // 90 < micro 90.27 → arms
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
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]); // split stays 92.69
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
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
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
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
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
    sells: [mkOrder('SELL', null), mkOrder('SELL', 'CANCELED', { orderId: 304, manual: true })],
  });
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
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
  for (const j of [priceJob(90), priceJob(93), job]) {
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
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
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
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
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
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
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
    buys: [mkOrder('BUY', null), mkOrder('BUY', null, { quantity: '2.000', price: '104.58' })],
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
  const r = priceJob(110).hybridShort(obj, 1, obj.SELL[1]); // 110 > micro 109.67 → arms
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

// ===== the anti-flap asymmetry =====
//
// The gate arms on the MICRO and releases on the SPLIT. Gate both on the split — as
// it did — and the two lines are one: a price grazing it arms and cancels the scalp
// tick after tick, burning the exchange and leaving the position without an exit
// order in between. Seen live on a narrow BNBUSDT ladder, where the micro sat seven
// cents under the split.
//
// The band in the fixture: micro 90.27 … split 92.69.

test('flap: price inside the band does NOT arm a new micro — it would sell into the book', () => {
  const obj = scalpObj(); // nothing resting yet
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]); // 90.27 < 91 < 92.69

  // A sell limit at 90.27 with the market at 91 is not a scalp — it is a market sell
  // dressed as one: it crosses the book and fills instantly at whatever is bid.
  assert.equal(r.role, undefined);
  assert.equal(r.data.quantity, '2.000'); // the whole-position close rests instead
  assert.equal(r.data.price, '95.38');
});

test('flap: price inside the band KEEPS a resting micro — it is not yanked', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 500, quantity: '1.000', price: '90.27', role: 'micro' }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 1, obj.BUY[1]); // same 91 as above

  assert.equal(r.method, 'getOrder'); // just polled — the micro stays on the book
  assert.equal(r.data.orderId, 500);
});

test('flap: only the split releases a resting micro, and the swap is flagged', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 500, quantity: '1.000', price: '90.27', role: 'micro' }),
    ],
  });
  const r = priceJob(93).hybridLong(obj, 1, obj.BUY[1]); // 93 > split 92.69

  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 500);
  // `swap` tells the engine the position is now without an exit order and the
  // replacement is owed NOW, not one full ladder of polling later.
  assert.equal(r.swap, true);
});

test('flap: the full close yielding to the micro is flagged as a swap too', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 300, quantity: '2.000', price: '95.38' }),
    ],
  });
  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]); // below the micro → arm

  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 300);
  assert.equal(r.swap, true);
});

test('flap: short mirrors it — arming needs the price ABOVE the micro buy-back', () => {
  const obj = scalpShortObj(); // micro 109.67, split 107.29
  const inBand = priceJob(108).hybridShort(obj, 1, obj.SELL[1]); // 107.29 < 108 < 109.67

  // A buy-back limit at 109.67 with the market at 108 sits ABOVE it → instant fill.
  assert.equal(inBand.role, undefined);
  assert.equal(inBand.data.quantity, '2.000');

  const above = priceJob(110).hybridShort(obj, 1, obj.SELL[1]);
  assert.equal(above.role, 'micro');
});

// ===== a micro is ALWAYS the hybrid's to finish — the arm knob gates NEW scalps only =====
// Seen live: with a micro resting on rung #3 the user raised "Grid from order" to #4.
// The rung fell out of the scalp gate and the classic machine adopted the micro as if
// it were the whole-position close — its fill would have ended the cycle with most of
// the position still held.

test('arm raised past a FILLED micro: still banked (REARM), never a classic DONE', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'FILLED', {
        orderId: 400,
        role: 'micro',
        quantity: '1.000',
        price: '90.27',
        executedQty: 1.0,
        cummulativeQuoteQty: 90.27,
      }),
    ],
  });
  obj.param['field-gridArm'] = '3'; // scalp now allowed only from rung #3 — rung #2 holds the micro

  const r = priceJob(93).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.status, 'REARM'); // the oscillation is real money — bank it wherever the aim points
});

test('arm raised past a LIVE micro: pulled and handed back, not adopted by classic', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 401, role: 'micro', quantity: '1.000', price: '90.27' }),
    ],
  });
  obj.param['field-gridArm'] = '3';

  const r = priceJob(90).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 401);
  assert.equal(r.swap, true); // the classic close is owed the same tick
});

test('deeper rung filled under a LIVE micro: the stale micro is pulled, scalp moves down', () => {
  const obj = scalpObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', {
        orderId: 2,
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        price: '90.00',
      }),
      mkOrder('BUY', 'FILLED', {
        orderId: 3,
        executedQty: 1.0,
        cummulativeQuoteQty: 80,
        price: '80.00',
      }),
    ],
    sells: [
      mkOrder('SELL', null),
      mkOrder('SELL', 'NEW', { orderId: 402, role: 'micro', quantity: '1.000', price: '90.27' }),
      mkOrder('SELL', null, { quantity: '3.000', price: '90.36' }),
    ],
  });

  const r = priceJob(85).hybridLong(obj, 1, obj.BUY[1]); // rung #2 is no longer the deepest
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 402);
  assert.equal(r.swap, true);
});

// ===== the TAIL: the rest of the position rests NEXT TO the micro =====
// User's partition: sells on the book always add up to the whole position, so a
// burst spike fills both orders and the cycle closes on the exchange — instead of
// racing the engine's reaction time. The tail sits on the rung right above the
// carrying one, priced like the whole-position close of rungs 0..D-1, bank folded in.

const microNew = (over = {}) =>
  mkOrder('SELL', 'NEW', { orderId: 600, role: 'micro', quantity: '1.000', price: '90.27', ...over });

test('tail: a live micro gets the remainder resting right above it', () => {
  const obj = scalpObj({ sells: [mkOrder('SELL', null), microNew()] });
  const r = priceJob(90).hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, 'tail');
  assert.equal(r.data.quantity, '1.000'); // everything the micro does not cover
  assert.equal(r.data.price, '100.40'); // rung 0's own close: 100 × 1.004
});

test('tail: the bank lowers it, like any exit', () => {
  const obj = scalpObj({ sells: [mkOrder('SELL', null), microNew()] });
  obj.gridRealized = 1;
  const r = priceJob(90).hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(r.data.price, '99.40'); // (100 − 1) × 1.004 — each banked micro pulls it down
});

test('tail: no micro resting → no tail, the rung stays byte-identical classic', () => {
  const obj = scalpObj(); // the deepest slot is empty — nothing to accompany
  const j = priceJob(90);
  assert.deepEqual(j.hybridLong(obj, 0, obj.BUY[0]), j.long(obj, 0, obj.BUY[0]));
});

// Three rungs held mid-transition: the micro moved to #3, an old tail still
// rests on #1 while its place is now #2.
function threeRungObj(sells) {
  return mkObj({
    buys: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', {
        orderId: 2,
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        price: '90.00',
      }),
      mkOrder('BUY', 'FILLED', {
        orderId: 3,
        executedQty: 1.0,
        cummulativeQuoteQty: 80,
        price: '80.00',
      }),
    ],
    sells,
    param: { 'field-gridLevel': '2', 'field-profit': '0.2', 'field-commission': '0.2' },
  });
}

test('tail: the ladder moved — a live tail off its slot is pulled', () => {
  const obj = threeRungObj([
    mkOrder('SELL', 'NEW', { orderId: 601, role: 'tail', quantity: '1.000', price: '100.40' }),
    mkOrder('SELL', null),
    mkOrder('SELL', 'NEW', { orderId: 602, role: 'micro', quantity: '1.000', price: '80.24' }),
  ]);
  const r = priceJob(80).hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 601);
  assert.equal(r.swap, true);
});

test('tail: oversell guard — while another close still rests, no tail is added', () => {
  const obj = threeRungObj([
    mkOrder('SELL', 'NEW', { orderId: 601, role: 'tail', quantity: '1.000', price: '100.40' }),
    mkOrder('SELL', null),
    mkOrder('SELL', 'NEW', { orderId: 602, role: 'micro', quantity: '1.000', price: '80.24' }),
  ]);
  // slot #2 is the tail's place, but the stray on #1 is still live this tick
  const r = priceJob(80).hybridLong(obj, 1, obj.BUY[1]);

  assert.equal(r.status, 'pass'); // nothing new on the book until the stray is gone
});

test('tail: filled while the carrying rung is still held → the cycle goes on', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', 'FILLED', {
        orderId: 603,
        role: 'tail',
        quantity: '1.000',
        price: '100.40',
        executedQty: 1.0,
        cummulativeQuoteQty: 100.4,
      }),
      microNew(),
    ],
  });
  const r = priceJob(90).hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(r.status, 'pass'); // rung 0 exited with profit; rung 1 keeps trading
});

test('tail: filled and nothing else held → the cycle ends', () => {
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', 'FILLED', {
        orderId: 604,
        role: 'tail',
        quantity: '1.000',
        price: '100.40',
        executedQty: 1.0,
        cummulativeQuoteQty: 100.4,
      }),
      mkOrder('SELL', 'FILLED', {
        orderId: 605,
        role: 'micro',
        quantity: '1.000',
        price: '90.27',
        executedQty: 1.0,
        cummulativeQuoteQty: 90.27,
      }),
    ],
  });
  const r = priceJob(91).hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(r.status, Status.DONE);
});

test('tail: a role-less leftover close off the tail slot is pulled the same way', () => {
  // the classic close of rung 1 kept resting while the ladder deepened to #3:
  // it now covers the wrong remainder and blocks the real tail on slot #2
  const obj = threeRungObj([
    mkOrder('SELL', 'NEW', { orderId: 610, quantity: '1.000', price: '100.40' }),
    mkOrder('SELL', null),
    mkOrder('SELL', 'NEW', { orderId: 611, role: 'micro', quantity: '1.000', price: '80.24' }),
  ]);
  const r = priceJob(80).hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 610);
  assert.equal(r.swap, true);
});

test('tail: a close already ON the tail slot is the tail de facto — left alone', () => {
  // the classic close of rungs 1-2 placed BEFORE the scalp took rung #3 over:
  // right volume, right slot — no reason to touch it (the burst catcher stays)
  const obj = scalpObj({
    sells: [
      mkOrder('SELL', 'NEW', { orderId: 612, quantity: '1.000', price: '100.40' }),
      microNew(),
    ],
  });
  const r = priceJob(90).hybridLong(obj, 0, obj.BUY[0]);

  assert.notEqual(r.method, 'cancelOrder');
});
