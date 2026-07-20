const test = require('node:test');
const assert = require('node:assert/strict');
const { orderResultPatch } = require('../modules/jsonTimerSender');

// What the iterator persists into a slot after an API result. The key fix
// pinned here: a newOrder result also persists the price/quantity ACTUALLY SENT
// (hybrid micro/exit and rebalanced DCA closes are priced at send time) — the
// stale plan value on the slot caused the false "re-placed" badge in the table.

test('newOrder: persists the actually sent price/quantity next to status/orderId', () => {
  const currentOrder = {
    method: 'newOrder',
    role: 'micro',
    data: { symbol: 'BNBUSDT', side: 'SELL', quantity: '0.600', price: '90.27' },
  };
  const message = { status: 'NEW', orderId: 42, side: 'SELL' };
  assert.deepEqual(orderResultPatch(currentOrder, message), {
    status: 'NEW',
    orderId: 42,
    role: 'micro',
    price: '90.27',
    quantity: '0.600',
  });
});

test('newOrder without role (classic DCA re-place): price/quantity still persisted', () => {
  const currentOrder = {
    method: 'newOrder',
    data: { quantity: '1.500', price: '93.71' },
  };
  const patch = orderResultPatch(currentOrder, { status: 'NEW', orderId: 7 });
  assert.equal(patch.price, '93.71');
  assert.equal(patch.quantity, '1.500');
  assert.ok(!('role' in patch));
});

test('getOrder poll result: status/orderId/fills only — the slot price is not touched', () => {
  const currentOrder = { method: 'getOrder', data: { orderId: 7 } };
  const message = {
    status: 'FILLED',
    orderId: 7,
    executedQty: '1.000',
    cummulativeQuoteQty: '90.27',
  };
  assert.deepEqual(orderResultPatch(currentOrder, message), {
    status: 'FILLED',
    orderId: 7,
    executedQty: 1.0,
    cummulativeQuoteQty: 90.27,
  });
});

test('cancelOrder result: no price leak either', () => {
  const currentOrder = { method: 'cancelOrder', data: { orderId: 9 } };
  const patch = orderResultPatch(currentOrder, { status: 'CANCELED', orderId: 9 });
  assert.ok(!('price' in patch));
  assert.ok(!('quantity' in patch));
});

test('fill fields are parsed to numbers (exchange sends strings)', () => {
  const patch = orderResultPatch(
    { method: 'getOrder', data: {} },
    { status: 'PARTIALLY_FILLED', orderId: 1, executedQty: '0.400', cummulativeQuoteQty: '36.1' }
  );
  assert.equal(patch.executedQty, 0.4);
  assert.equal(patch.cummulativeQuoteQty, 36.1);
});
