const test = require('node:test');
const assert = require('node:assert/strict');
const { needsRecoveryConsolidation } = require('../modules/jsonTimerSender');

// Шаг 3 — детектор «сетка исчерпана + перекрытые закрытия». Чистая функция,
// проверяется без биржи. true только когда ВСЕ entry FILLED и ≥2 живых NEW
// закрытия (типовой итог залпового залива по фитилю на testnet).

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

test('long: not all BUY filled → false (mid-grid is Step 2 territory)', () => {
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
