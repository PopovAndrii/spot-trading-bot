const test = require('node:test');
const assert = require('node:assert/strict');
const { recoveryStats } = require('../lib/recoveryStats');

// Статистика возврата по прожитой сессии: зависший объём + курс безубытка
// всей серии, по РЕАЛЬНЫМ исполнениям (executedQty / cummulativeQuoteQty).

const param = (over = {}) => ({
  'field-strategy': 'long',
  'field-commission': '0.20',
  'field-tickSize': '2',
  'field-stepSize': '3',
  ...over,
});

const buy = (executedQty, cummulativeQuoteQty) => ({ side: 'BUY', executedQty, cummulativeQuoteQty });
const sell = (executedQty, cummulativeQuoteQty) => ({ side: 'SELL', executedQty, cummulativeQuoteQty });

test('long: остаток на руках → курс безубытка всей серии', () => {
  // куплено 8.773 за 4962.08, продано 7.826 за 4765.98 → зависло 0.947,
  // деньгами не вернулось 196.10 → 196.10 / 0.947 / 0.998 ≈ 207.49
  const session = {
    pair: 'BNBUSDT',
    param: param(),
    BUY: [buy(7.826, 4451.42), buy(0.947, 510.66)],
    SELL: [sell(7.826, 4765.98)],
  };
  const r = recoveryStats(session);
  assert.equal(r.strandedQty, 0.947);
  assert.equal(r.breakevenPrice, 207.49);
  assert.equal(r.alreadyProfit, false);
  assert.equal(r.text, 'Вам нужно продать 0.947 BNB не ниже по курсу 207.49');
});

test('позиция закрыта целиком → null', () => {
  const session = {
    pair: 'BNBUSDT',
    param: param(),
    BUY: [buy(1, 600)],
    SELL: [sell(1, 610)],
  };
  assert.equal(recoveryStats(session), null);
});

test('серия уже в плюсе (вернули больше потраченного) → alreadyProfit', () => {
  const session = {
    pair: 'BNBUSDT',
    param: param(),
    BUY: [buy(2, 1200)],
    SELL: [sell(1.5, 1300)],
  };
  const r = recoveryStats(session);
  assert.equal(r.alreadyProfit, true);
  assert.equal(r.breakevenPrice, 0);
  assert.match(r.text, /уже в плюсе/);
});

test('short: зеркально — выкупить не выше курса', () => {
  const session = {
    pair: 'BNBUSDT',
    param: param({ 'field-strategy': 'short' }),
    SELL: [sell(2, 1220)],
    BUY: [buy(1.2, 700)],
  };
  const r = recoveryStats(session);
  assert.equal(r.strategy, 'short');
  assert.equal(r.strandedQty, 0.8);
  assert.match(r.text, /^Вам нужно купить 0\.8 BNB не выше по курсу /);
});

test('пустая/битая сессия → null', () => {
  assert.equal(recoveryStats(null), null);
  assert.equal(recoveryStats({}), null);
  assert.equal(recoveryStats({ pair: 'BNBUSDT', param: param(), BUY: 'nope' }), null);
});
