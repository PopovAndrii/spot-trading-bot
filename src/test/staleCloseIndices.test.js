const test = require('node:test');
const assert = require('node:assert/strict');
const { staleCloseIndices } = require('../modules/jsonTimerSender');

// When a micro banks, every resting whole-position close was priced BEFORE that
// profit existed — the REARM handler pulls them so the next pass re-places each
// at the bank-adjusted price (user: "текущий ордер + профит стрижки = пересчёт →
// перевыставление"). These tests pin what counts as stale: a live, robot-owned,
// non-micro close — and nothing else.

const close = (status, over = {}) => ({
  status,
  orderId: 500,
  quantity: '1.000',
  price: '100.00',
  ...over,
});

test('stale: live closes are selected, both NEW and PARTIALLY_FILLED', () => {
  const obj = {
    SELL: [close('NEW'), close('PARTIALLY_FILLED', { orderId: 501, executedQty: 0.4 })],
  };
  assert.deepEqual(staleCloseIndices(obj, 'long'), [0, 1]);
});

test('stale: a resting micro is never stale — it IS the scalp', () => {
  const obj = { SELL: [close('NEW', { role: 'micro' })] };
  assert.deepEqual(staleCloseIndices(obj, 'long'), []);
});

test('stale: a manual pull stays the user decision', () => {
  const obj = { SELL: [close('NEW', { manual: true })] };
  assert.deepEqual(staleCloseIndices(obj, 'long'), []);
});

test('stale: never-placed, filled and canceled slots are not on the exchange', () => {
  const obj = {
    SELL: [
      close(null, { orderId: null }),
      close('FILLED'),
      close('CANCELED'),
      null,
      close('NEW', { orderId: null }), // no orderId → nothing to cancel
    ],
  };
  assert.deepEqual(staleCloseIndices(obj, 'long'), []);
});

test('stale: short mirrors — the closes are the BUY side', () => {
  const obj = {
    BUY: [close('NEW')],
    SELL: [close('NEW', { orderId: 502 })], // short entries, not closes
  };
  assert.deepEqual(staleCloseIndices(obj, 'short'), [0]);
});

test('stale: a resting tail IS stale — it must follow the bank', () => {
  const obj = { SELL: [close('NEW', { role: 'tail' })] };
  assert.deepEqual(staleCloseIndices(obj, 'long'), [0]);
});
