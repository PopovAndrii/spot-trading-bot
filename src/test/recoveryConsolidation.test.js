const test = require('node:test');
const assert = require('node:assert/strict');
const { needsRecoveryConsolidation } = require('../modules/jsonTimerSender');

// Detector for "entry grid exhausted + overlapping closes". Pure function,
// testable without the exchange. true only when ALL entries are FILLED and there
// are ≥2 live NEW closes (the typical result of a burst fill on a testnet wick).

const o = (status, over = {}) => ({ status, orderId: null, ...over });

test('long: all BUY filled + 2 live NEW closes → true', () => {
  const obj = {
    BUY: [o('FILLED'), o('FILLED'), o('FILLED')],
    SELL: [o('NEW', { orderId: 1 }), o(null), o('NEW', { orderId: 2 })],
  };
  assert.equal(needsRecoveryConsolidation(obj, 'long'), true);
});

test('long: all BUY filled but only ONE live close → false (healthy, let it ride)', () => {
  const obj = {
    BUY: [o('FILLED'), o('FILLED'), o('FILLED')],
    SELL: [o('CANCELED'), o(null), o('NEW', { orderId: 2 })],
  };
  assert.equal(needsRecoveryConsolidation(obj, 'long'), false);
});

test('long: not all BUY filled → false (mid-grid territory)', () => {
  const obj = {
    BUY: [o('FILLED'), o('FILLED'), o('NEW', { orderId: 9 })],
    SELL: [o('NEW', { orderId: 1 }), o('NEW', { orderId: 2 }), o(null)],
  };
  assert.equal(needsRecoveryConsolidation(obj, 'long'), false);
});

test('long: after consolidation (closes cleared, one null) → false → Start places it', () => {
  const obj = {
    BUY: [o('FILLED'), o('FILLED'), o('FILLED')],
    SELL: [o('CANCELED', { orderId: 1 }), o('CANCELED', { orderId: 2 }), o(null)],
  };
  assert.equal(needsRecoveryConsolidation(obj, 'long'), false);
});

test('short: all SELL filled + 2 live NEW buy-closes → true', () => {
  const obj = {
    SELL: [o('FILLED'), o('FILLED'), o('FILLED')],
    BUY: [o('NEW', { orderId: 1 }), o(null), o('NEW', { orderId: 2 })],
  };
  assert.equal(needsRecoveryConsolidation(obj, 'short'), true);
});

test('empty / missing arrays → false', () => {
  assert.equal(needsRecoveryConsolidation({}, 'long'), false);
  assert.equal(needsRecoveryConsolidation({ BUY: [], SELL: [] }, 'long'), false);
});
