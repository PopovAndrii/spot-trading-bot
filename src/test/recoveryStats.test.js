const test = require('node:test');
const assert = require('node:assert/strict');
const { recoveryStats } = require('../lib/recoveryStats');

// Recovery stats for a lived session: the stranded quantity + the whole-series
// break-even price, from the ACTUAL fills (executedQty / cummulativeQuoteQty).

const param = (over = {}) => ({
  'field-strategy': 'long',
  'field-commission': '0.20',
  'field-tickSize': '2',
  'field-stepSize': '3',
  ...over,
});

const buy = (executedQty, cummulativeQuoteQty) => ({
  side: 'BUY',
  executedQty,
  cummulativeQuoteQty,
});
const sell = (executedQty, cummulativeQuoteQty) => ({
  side: 'SELL',
  executedQty,
  cummulativeQuoteQty,
});

test('long: leftover on hand → whole-series break-even price', () => {
  // bought 8.773 for 4962.08, sold 7.826 for 4765.98 → 0.947 stranded,
  // 196.10 not returned in money → 196.10 / 0.947 / 0.998 ≈ 207.49
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
  assert.equal(
    r.text,
    'If you want to stop the session, to break even you need to sell 0.947 BNB at no less than 207.49. ' +
    "This is a one-time sell — you don't need to buy it back afterwards."
  );
});

test('position fully closed → null', () => {
  const session = {
    pair: 'BNBUSDT',
    param: param(),
    BUY: [buy(1, 600)],
    SELL: [sell(1, 610)],
  };
  assert.equal(recoveryStats(session), null);
});

test('series already in profit (returned more than spent) → alreadyProfit', () => {
  const session = {
    pair: 'BNBUSDT',
    param: param(),
    BUY: [buy(2, 1200)],
    SELL: [sell(1.5, 1300)],
  };
  const r = recoveryStats(session);
  assert.equal(r.alreadyProfit, true);
  assert.equal(r.breakevenPrice, 0);
  assert.match(r.text, /already in profit/);
});

test('short: mirrored — buy back no higher than the price', () => {
  const session = {
    pair: 'BNBUSDT',
    param: param({ 'field-strategy': 'short' }),
    SELL: [sell(2, 1220)],
    BUY: [buy(1.2, 700)],
  };
  const r = recoveryStats(session);
  assert.equal(r.strategy, 'short');
  assert.equal(r.strandedQty, 0.8);
  assert.match(
    r.text,
    /^If you want to stop the session, to break even you need to buy 0\.8 BNB at no more than /
  );
});

test('empty/corrupt session → null', () => {
  assert.equal(recoveryStats(null), null);
  assert.equal(recoveryStats({}), null);
  assert.equal(recoveryStats({ pair: 'BNBUSDT', param: param(), BUY: 'nope' }), null);
});
