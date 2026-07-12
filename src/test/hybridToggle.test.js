const test = require('node:test');
const assert = require('node:assert/strict');
const { Job, Status, hybridDirty, hybridSwitch } = require('../lib/job');
const { applyOrderResult } = require('../modules/jsonTimerSender');

// The hybrid switch is LIVE: param['field-hybrid'] is re-read every tick, so the
// scalp can be armed on a cycle that started classic and disarmed on one that is
// mid-oscillation. Two things make that safe, and these tests pin both:
//
//   field-gridArm — snapshot of the rung the price is stuck on, taken at switch-on.
//     The scalp floor is the DEEPER of it and the configured field-gridLevel, so a
//     recovery can never walk micro orders back up the ladder.
//   hybridEnabled — off means no NEW scalp, but the machine keeps its own cleanup:
//     a resting micro is canceled and the whole-position close returns. The classic
//     machine must never be handed a live micro (it has no concept of the role and
//     would read a rung-sized fill as the whole position closing).

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

// Same fixture as jobHybrid: rung 0 filled 1.0 @ 100, rung 1 filled 1.0 @ 90.
// gridLevel=2 → g=1, D=1. Whole-position close 2.000 @ 95.38, split 92.69,
// micro 90.27. A price of 91 sits in the scalp zone (below the split).
function scalpObj(param = {}, sells = null) {
  return {
    status: Status.READY,
    pair: 'BNBUSDT',
    param: {
      'field-stepSize': '3',
      'field-tickSize': '2',
      'field-gridLevel': '2',
      'field-profit': '0.2',
      'field-commission': '0.2',
      ...param,
    },
    BUY: [
      mkOrder('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mkOrder('BUY', 'FILLED', {
        orderId: 2,
        executedQty: 1.0,
        cummulativeQuoteQty: 90,
        price: '90.00',
      }),
    ],
    SELL: sells || [
      mkOrder('SELL', null),
      mkOrder('SELL', null, { quantity: '2.000', price: '95.38' }),
    ],
  };
}

function scalpJob(enabled = true) {
  const j = new Job(false);
  j.price = 91; // inside the scalp zone
  j.hybridEnabled = enabled;
  return j;
}

const microSell = (over = {}) =>
  mkOrder('SELL', 'NEW', { orderId: 9, role: 'micro', quantity: '1.000', price: '90.27', ...over });

// ===== hybridDirty: does the scalp still own something on the table? =====

test('hybridDirty: a clean cycle is not dirty', () => {
  assert.equal(hybridDirty(scalpObj(), 'long'), false);
});

test('hybridDirty: any micro marker on a close makes the cycle dirty', () => {
  for (const status of ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED']) {
    const obj = scalpObj({}, [mkOrder('SELL', null), microSell({ status })]);
    assert.equal(hybridDirty(obj, 'long'), true, status);
  }
});

test('hybridDirty: reads the close side of the strategy (short closes with BUY)', () => {
  const obj = scalpObj();
  obj.BUY[1].role = 'micro';
  assert.equal(hybridDirty(obj, 'short'), true);
  assert.equal(hybridDirty(obj, 'long'), false); // the SELL side is clean
});

// ===== field-gridArm: the live floor, and it wins outright =====

test('gridArm deeper than the deepest fill: the scalp WAITS for it — pure DCA meanwhile', () => {
  // "not this order, wait for #3": aimed at rung 3 while only rung 2 is filled
  const obj = scalpObj({ 'field-gridArm': '3' });
  const job = scalpJob();
  for (const i of [0, 1]) {
    assert.deepEqual(job.hybridLong(obj, i, obj.BUY[i]), job.long(obj, i, obj.BUY[i]));
  }
});

test('gridArm wins over the config, shallower included — a hand edit is a decision', () => {
  const obj = scalpObj({ 'field-gridLevel': '5', 'field-gridArm': '2' }); // arm 2 → g = 1 = D
  const r = scalpJob().hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, 'micro');
  assert.equal(r.data.quantity, '1.000'); // the rung's own volume, not the position
});

test('gridArm absent: the saved config is the floor, as before the live switch existed', () => {
  const r = scalpJob().hybridLong(scalpObj(), 1, scalpObj().BUY[1]);
  assert.equal(r.role, 'micro');
});

// ===== hybridEnabled=false: no new scalp, but the hybrid cleans up after itself =====

test('switch off in the scalp zone: no micro is armed, the whole-position close is placed', () => {
  const obj = scalpObj();
  const r = scalpJob(false).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, undefined);
  assert.equal(r.data.quantity, '2.000'); // the whole position, priced off the fills
  assert.equal(r.data.price, '95.38');
});

test('switch off with a micro resting: it is canceled, never handed to the classic machine', () => {
  const obj = scalpObj({}, [mkOrder('SELL', null), microSell()]);
  const r = scalpJob(false).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.side, 'SELL');
  assert.equal(r.data.orderId, 9);
});

test('switch off with a micro already FILLED: the oscillation is still banked (REARM)', () => {
  const obj = scalpObj({}, [
    mkOrder('SELL', null),
    microSell({ status: 'FILLED', executedQty: 1.0, cummulativeQuoteQty: 90.27 }),
  ]);
  const r = scalpJob(false).hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.status, 'REARM');
  assert.equal(r.id, 1);
});

test('switch off, price outside the zone: identical to the switch being off inside it', () => {
  const obj = scalpObj();
  const j = scalpJob(false);
  j.price = 99; // above the split — classic either way
  const r = j.hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.data.quantity, '2.000');
});

test('switch off with an unknown price still places the close (no scalp gate to read)', () => {
  const obj = scalpObj();
  const j = scalpJob(false);
  j.price = null;
  const r = j.hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.data.quantity, '2.000');
});

// ===== hybridSwitch: what the button writes into param =====

test('hybridSwitch on: aims at the deepest held rung, leaves the saved config alone', () => {
  const obj = scalpObj(); // rungs 1 and 2 filled
  const next = hybridSwitch(obj.param, obj.BUY, true);

  assert.equal(next['field-hybrid'], 'on');
  assert.equal(next['field-gridArm'], '2'); // deepest fill = rung #2
  assert.equal(next['field-gridLevel'], '2'); // untouched
});

test('hybridSwitch on: the AUTOMATIC aim never goes shallower than the config', () => {
  // deepest fill is rung 2, but the user configured "never above #4"
  const obj = scalpObj({ 'field-gridLevel': '4' });
  const next = hybridSwitch(obj.param, obj.BUY, true);

  assert.equal(next['field-gridArm'], '4'); // the robot obeys the config...
  assert.equal(next['field-gridLevel'], '4');

  // ...but a hand edit may go anywhere (that is the point of the field)
  const byHand = { ...next, 'field-gridArm': '2' };
  assert.equal(scalpJob().hybridLong({ ...scalpObj(), param: byHand }, 1, scalpObj().BUY[1]).role, 'micro');
});

test('hybridSwitch on: nothing held → no snapshot, the configured floor rules alone', () => {
  const obj = scalpObj();
  obj.BUY = [mkOrder('BUY', 'NEW', { orderId: 1 }), mkOrder('BUY', null)];
  const next = hybridSwitch(obj.param, obj.BUY, true);

  assert.equal(next['field-hybrid'], 'on');
  assert.equal('field-gridArm' in next, false);
});

test('hybridSwitch off: drops the switch AND the snapshot, so the next on re-takes it', () => {
  const obj = scalpObj({ 'field-gridArm': '5' });
  const next = hybridSwitch(obj.param, obj.BUY, false);

  assert.equal(next['field-hybrid'], 'off');
  assert.equal('field-gridArm' in next, false);
  assert.equal(next['field-gridLevel'], '2'); // the floor survives the toggle
});

test('hybridSwitch: re-arming deeper moves the floor down, never up', () => {
  const obj = scalpObj({ 'field-gridArm': '2' });
  obj.BUY.push(
    mkOrder('BUY', 'FILLED', {
      orderId: 3,
      executedQty: 1.0,
      cummulativeQuoteQty: 80,
      price: '80.00',
    })
  );
  const next = hybridSwitch(obj.param, obj.BUY, true);
  assert.equal(next['field-gridArm'], '3');
});

test('hybridSwitch does not mutate the param it is given', () => {
  const obj = scalpObj();
  const before = JSON.stringify(obj.param);
  hybridSwitch(obj.param, obj.BUY, true);
  assert.equal(JSON.stringify(obj.param), before);
});

// ===== applyOrderResult: the stale-role deletion Object.assign cannot express =====

test('applyOrderResult: a roleless newOrder drops the micro marker left on the slot', () => {
  const slot = mkOrder('SELL', 'CANCELED', { orderId: 9, role: 'micro' });
  const currentOrder = {
    method: 'newOrder',
    id: 1,
    side: 'SELL',
    data: { quantity: '2.000', price: '95.38' },
  };
  applyOrderResult(slot, currentOrder, { status: 'NEW', orderId: 11, side: 'SELL' });

  assert.equal(slot.role, undefined); // else the filled close would read as a banked micro
  assert.equal(slot.status, 'NEW');
  assert.equal(slot.orderId, 11);
  assert.equal(slot.quantity, '2.000');
  assert.equal(slot.price, '95.38');
});

test('applyOrderResult: a micro newOrder marks the slot', () => {
  const slot = mkOrder('SELL', null);
  const currentOrder = {
    method: 'newOrder',
    id: 1,
    side: 'SELL',
    role: 'micro',
    data: { quantity: '1.000', price: '90.27' },
  };
  applyOrderResult(slot, currentOrder, { status: 'NEW', orderId: 12, side: 'SELL' });
  assert.equal(slot.role, 'micro');
});

test('applyOrderResult: polling/canceling a live micro keeps its marker', () => {
  for (const method of ['getOrder', 'cancelOrder']) {
    const slot = mkOrder('SELL', 'NEW', { orderId: 9, role: 'micro' });
    applyOrderResult(slot, { method, id: 1, side: 'SELL' }, { status: 'CANCELED', orderId: 9 });
    assert.equal(slot.role, 'micro', method);
  }
});

// ===== the whole drain, tick by tick, with the slot persisted as the engine does =====

test('switching off mid-oscillation drains to a clean classic close, and it stays classic', () => {
  const obj = scalpObj();
  const job = scalpJob(); // armed, price 91 (in the zone)

  // tick 1 — armed: the micro takes the deepest rung's own volume
  let r = job.hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, 'micro');
  applyOrderResult(obj.SELL[1], r, { status: 'NEW', orderId: 9, side: 'SELL' });
  assert.equal(obj.SELL[1].role, 'micro');
  assert.equal(hybridDirty(obj, 'long'), true);

  // tick 2 — the switch goes off while the micro rests: it must be PULLED, never
  // left for the classic machine to poll as if it were the whole-position close
  job.hybridEnabled = false;
  r = job.hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'cancelOrder');
  assert.equal(r.data.orderId, 9);
  applyOrderResult(obj.SELL[1], r, { status: 'CANCELED', orderId: 9, side: 'SELL' });

  // still dirty → the hybrid keeps the wheel for one more tick to put the real
  // close back, priced off the fills (1.0 @ 100 + 1.0 @ 90 → 2.000 @ 95.38)
  assert.equal(hybridDirty(obj, 'long'), true);
  r = job.hybridLong(obj, 1, obj.BUY[1]);
  assert.equal(r.method, 'newOrder');
  assert.equal(r.role, undefined);
  assert.equal(r.data.quantity, '2.000');
  assert.equal(r.data.price, '95.38');
  applyOrderResult(obj.SELL[1], r, { status: 'NEW', orderId: 12, side: 'SELL' });

  // the marker is gone with it → the cycle is clean and routes classic again
  assert.equal(obj.SELL[1].role, undefined);
  assert.equal(hybridDirty(obj, 'long'), false);

  // and when that close fills it is a CLOSED CYCLE, not a banked micro: a stale
  // 'micro' marker here would REARM — bank the whole close into gridRealized and
  // re-buy the rung on a position that no longer exists
  obj.SELL[1].status = 'FILLED';
  obj.SELL[1].executedQty = 2.0;
  obj.SELL[1].cummulativeQuoteQty = 190.76;
  r = job.hybridLong(obj, 1, obj.BUY[1]);
  assert.notEqual(r.status, 'REARM');
  assert.deepEqual(r, job.long(obj, 1, obj.BUY[1]));
  assert.equal(r.status, Status.DONE);
});
