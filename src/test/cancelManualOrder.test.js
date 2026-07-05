const test = require('node:test');
const assert = require('node:assert/strict');
const JsonTimerSender = require('../modules/jsonTimerSender');

// DEEP_ANALYSIS_PLAN.md Item 10 — manual single-order cancel (cancelManualOrder).
// Contract: mark the pull in this.manualPulls OPTIMISTICALLY (before the exchange
// responds) so the very next readLoop tick already sees `manual` and the engine
// never re-places ("resurrects") an order whose cancel ACK lagged. A failed/invalid
// cancel must roll the flag back — otherwise a still-live order would be skipped.
// Pure unit: the exchange call is mocked, nothing touches a real API.

function setup() {
  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = 'TESTUSDT';
  sender.running[sender.symbol] = true;

  const calls = [];
  sender.API = {
    cancelOrder: async (data) => {
      calls.push(data);
      return { success: true, message: { orderId: data.orderId, status: 'CANCELED' } };
    },
  };
  return { sender, calls };
}

test('cancelManualOrder: cancels on exchange, then records the pull', async () => {
  const { sender, calls } = setup();

  const r = await sender.cancelManualOrder({ side: 'BUY', index: 2, orderId: 123 });

  assert.equal(r.success, true);
  assert.deepEqual(calls, [{ symbol: 'TESTUSDT', orderId: 123 }]); // exact one call
  assert.equal(sender.manualPulls.BUY.has(2), true);
  assert.equal(sender.manualPulls.SELL.has(2), false);
});

test('cancelManualOrder: cycle not running → fail, no API call, no mark', async () => {
  const { sender, calls } = setup();
  sender.running[sender.symbol] = false;

  const r = await sender.cancelManualOrder({ side: 'BUY', index: 0, orderId: 1 });

  assert.equal(r.success, false);
  assert.equal(calls.length, 0);
  assert.equal(sender.manualPulls.BUY.size, 0);
});

test('cancelManualOrder: invalid side / index / orderId → fail, no API call', async () => {
  const { sender, calls } = setup();

  assert.equal(
    (await sender.cancelManualOrder({ side: 'XXX', index: 0, orderId: 1 })).success,
    false
  );
  assert.equal(
    (await sender.cancelManualOrder({ side: 'BUY', index: 1.5, orderId: 1 })).success,
    false
  );
  assert.equal(
    (await sender.cancelManualOrder({ side: 'BUY', index: 0, orderId: null })).success,
    false
  );
  assert.equal(calls.length, 0);
  assert.equal(sender.manualPulls.BUY.size, 0);
});

test('cancelManualOrder: exchange cancel fails → flag rolled back, NOT marked manual', async () => {
  const { sender } = setup();
  sender.API.cancelOrder = async () => ({ success: false, message: 'order already filled' });

  const r = await sender.cancelManualOrder({ side: 'SELL', index: 3, orderId: 9 });

  assert.equal(r.success, false);
  assert.equal(sender.manualPulls.SELL.has(3), false); // must not skip a live order
});

test('cancelManualOrder: flag is set WHILE the exchange cancel is still in flight', async () => {
  const { sender } = setup();
  // Capture manualPulls state at the moment the (slow) exchange call runs — this
  // is the window in which a lagging ACK previously let the engine resurrect the
  // order. The optimistic mark must already be visible here.
  let flagDuringCall = null;
  sender.API.cancelOrder = async (data) => {
    flagDuringCall = sender.manualPulls.BUY.has(4);
    return { success: true, message: { orderId: data.orderId, status: 'CANCELED' } };
  };

  const r = await sender.cancelManualOrder({ side: 'BUY', index: 4, orderId: 7 });

  assert.equal(flagDuringCall, true); // marked before the ACK, not after
  assert.equal(r.success, true);
  assert.equal(sender.manualPulls.BUY.has(4), true);
});
