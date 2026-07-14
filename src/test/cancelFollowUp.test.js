const test = require('node:test');
const assert = require('node:assert/strict');
const { cancelFollowUp, probeCall, applyOrderResult } = require('../modules/jsonTimerSender');
const { Job, Status } = require('../lib/job');

// The deadlock this guards against, seen live on BNBUSDT:
//
// A micro filled between two polls. The engine never asked — it had already decided
// to pull the order (the ladder had deepened past its rung), so it sent cancelOrder
// and got -2011 back. A cancel that cancels nothing was swallowed as a plain failure
// and retried, forever: the slot stayed NEW, and the whole-position close — which the
// classic path may only place once every lower close is off the book — was never
// reached. The position sat on the exchange with no exit order at all for hours,
// while the table cheerfully reported "full close rests".
//
// The rule these tests pin: a cancel is never the last word on an order it did not
// cancel. `gone` → go ask, then record the truth.

const cancel = (over = {}) => ({
  status: null,
  method: 'cancelOrder',
  side: 'SELL',
  id: 4,
  data: { id: 4, symbol: 'BNBUSDT', orderId: 6301010 },
  ...over,
});

// ===== cancelFollowUp: when does a cancel owe us a question? =====

test('gone cancel → ask the exchange what really happened', () => {
  const slot = { status: 'NEW', orderId: 6301010, role: 'micro' };
  const followUp = cancelFollowUp(cancel(), { success: false, gone: true }, slot);

  assert.equal(followUp.method, 'getOrder');
  assert.equal(followUp.data.orderId, 6301010); // the same order, not a new one
  assert.equal(followUp.side, 'SELL');
  assert.equal(followUp.id, 4);
  // the stale status travels with it, so the iterator reads any real one as a change
  assert.equal(followUp.status, 'NEW');
});

test('gone cancel keeps the swap flag → the replacement still lands next tick', () => {
  const followUp = cancelFollowUp(cancel({ swap: true }), { gone: true }, { status: 'NEW' });
  assert.equal(followUp.swap, true);
});

test('a cancel that FAILED for any other reason → no follow-up, it is retried', () => {
  // a network drop must stay a retry: the order may well still be open
  assert.equal(cancelFollowUp(cancel(), { success: false, message: 'ETIMEDOUT' }, {}), null);
  assert.equal(cancelFollowUp(cancel(), null, {}), null);
});

test('a cancel that SUCCEEDED → no follow-up', () => {
  assert.equal(cancelFollowUp(cancel(), { success: true, message: {} }, {}), null);
});

test('gone on anything but a cancel → no follow-up', () => {
  const order = cancel({ method: 'newOrder' });
  assert.equal(cancelFollowUp(order, { gone: true }, {}), null);
});

test('gone cancel without an orderId → nothing to ask about', () => {
  const order = cancel({ data: { id: 4, symbol: 'BNBUSDT' } });
  assert.equal(cancelFollowUp(order, { gone: true }, {}), null);
});

// ===== probeCall: the micro is asked about before it is pulled =====

test('a micro pull is probed first — the cancel never races its own fill', () => {
  const probe = probeCall(cancel({ probe: true }), { status: 'NEW' });

  assert.equal(probe.method, 'getOrder');
  assert.equal(probe.data.orderId, 6301010);
  assert.equal(probe.status, 'NEW');
});

test('an unprobed cancel is left alone — classic only ever pulls the dead', () => {
  assert.equal(probeCall(cancel(), { status: 'NEW' }), null);
});

test('the engine marks every micro pull for a probe', () => {
  const obj = deepenedObj();
  const d = scalpJob().hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(d.method, 'cancelOrder');
  assert.equal(d.probe, true, 'a micro rests at the market — never pull it blind');
});

// ===== the deadlock, end to end =====

// Rung 0 filled 1.0 @ 100, rung 1 filled 1.0 @ 90 — the ladder has deepened, so the
// micro resting on rung 0 is off the deepest rung and the engine wants it pulled.
// Meanwhile it filled on the exchange.
function deepenedObj() {
  const mk = (side, status, over = {}) => ({
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

  return {
    status: Status.READY,
    pair: 'BNBUSDT',
    param: {
      'field-stepSize': '3',
      'field-tickSize': '2',
      'field-gridLevel': '1',
      'field-profit': '0.2',
      'field-commission': '0.2',
      'field-microProfit': '0.1',
      'field-gridExit': '61',
    },
    BUY: [
      mk('BUY', 'FILLED', { orderId: 1, executedQty: 1.0, cummulativeQuoteQty: 100 }),
      mk('BUY', 'FILLED', { orderId: 2, executedQty: 1.0, cummulativeQuoteQty: 90, price: '90.00' }),
    ],
    SELL: [
      mk('SELL', 'NEW', { orderId: 9, role: 'micro', quantity: '1.000', price: '100.30' }),
      mk('SELL', null, { quantity: '2.000', price: '95.38' }),
    ],
  };
}

const scalpJob = () => {
  const j = new Job(false);
  j.price = 101; // above everything: the scalp is out of the zone, the exit is owed
  j.hybridEnabled = true;
  return j;
};

test('the stale micro is pulled — that is the decision that hits -2011', () => {
  const obj = deepenedObj();
  const d = scalpJob().hybridLong(obj, 0, obj.BUY[0]);

  assert.equal(d.method, 'cancelOrder');
  assert.equal(d.data.orderId, 9);
});

test('cancel comes back gone, the truth is recorded → the leg banks instead of deadlocking', () => {
  const obj = deepenedObj();
  const job = scalpJob();

  // the pull the engine decided on, refused by the exchange: the micro had filled
  const currentOrder = job.hybridLong(obj, 0, obj.BUY[0]);
  const followUp = cancelFollowUp(currentOrder, { success: false, gone: true }, obj.SELL[0]);
  assert.ok(followUp, 'a gone cancel must produce a question');

  // what the exchange answers, applied through the normal result path
  const message = {
    status: 'FILLED',
    orderId: 9,
    side: 'SELL',
    executedQty: '1.000',
    cummulativeQuoteQty: '100.30',
  };
  applyOrderResult(obj.SELL[followUp.id], followUp, message);

  assert.equal(obj.SELL[0].status, 'FILLED');
  assert.equal(obj.SELL[0].executedQty, 1.0);
  assert.equal(obj.SELL[0].cummulativeQuoteQty, 100.3);
  assert.equal(obj.SELL[0].role, 'micro', 'the role must survive — the bank reads it');

  // and now the engine moves: the oscillation is banked, not re-cancelled
  const next = job.hybridLong(obj, 0, obj.BUY[0]);
  assert.equal(next.status, 'REARM');
  assert.notEqual(next.method, 'cancelOrder');
});

test('with the micro off the book the whole-position close is finally placed', () => {
  const obj = deepenedObj();
  const job = scalpJob();

  // the micro is resolved and its leg re-armed (what the REARM handler does)
  obj.SELL[0] = { ...obj.SELL[0], status: null, orderId: null, role: undefined };
  obj.BUY[0] = { ...obj.BUY[0], status: null, orderId: null, executedQty: 0 };

  const d = job.hybridLong(obj, 1, obj.BUY[1]);

  assert.equal(d.method, 'newOrder', 'the exit the deadlock was starving');
  assert.equal(d.side, 'SELL');
});
