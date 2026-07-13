const test = require('node:test');
const assert = require('node:assert/strict');
const { rebalanceClose } = require('../lib/rebalanceClose');

// approximate comparison for floats
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('no closes — closes the whole position', () => {
  const r = rebalanceClose([{ executedQty: 2, cummulativeQuoteQty: 200 }], [], 'long', 0);
  near(r.quantity, 2);
  near(r.avgEntryPrice, 100);
  near(r.price, 100);
});

test('long: partial close reduces volume and average', () => {
  const entries = [{ executedQty: 0.143, cummulativeQuoteQty: 103.15 }];
  const r = rebalanceClose(entries, { executedQty: 0.05, cummulativeQuoteQty: 36.3 }, 'long', 0.45);
  near(r.quantity, 0.093);
  near(r.avgEntryPrice, 66.85 / 0.093);
  near(r.price, (66.85 / 0.093) * 1.0045); // long → avg × (1 + fees%)
});

test('multiple closes accumulate', () => {
  const entries = [
    { executedQty: 1, cummulativeQuoteQty: 700 },
    { executedQty: 0.5, cummulativeQuoteQty: 350 },
  ];
  const closes = [
    { executedQty: 0.3, cummulativeQuoteQty: 210 },
    { executedQty: 0.2, cummulativeQuoteQty: 140 },
  ];
  const r = rebalanceClose(entries, closes, 'long', 0);
  near(r.quantity, 1); // 1.5 − 0.5
  near(r.avgEntryPrice, 700); // 700 / 1
  near(r.price, 700);
});

test('position fully closed / overshot → null', () => {
  const entries = [{ executedQty: 1, cummulativeQuoteQty: 100 }];
  assert.equal(
    rebalanceClose(entries, { executedQty: 1, cummulativeQuoteQty: 100 }, 'long', 0.45),
    null
  );
  assert.equal(
    rebalanceClose(entries, { executedQty: 1.2, cummulativeQuoteQty: 120 }, 'long', 0.45),
    null
  );
});

test('short: close price below average (factor 1 − fees%)', () => {
  const r = rebalanceClose([{ executedQty: 1, cummulativeQuoteQty: 100 }], [], 'short', 1);
  near(r.avgEntryPrice, 100);
  near(r.price, 99); // short → avg × (1 − 1%)
});

test('long: banked scalp profit lowers the exit, avgEntryPrice untouched', () => {
  const entries = [{ executedQty: 0.051, cummulativeQuoteQty: 29.05735 }];
  const r = rebalanceClose(entries, [], 'long', 0.4, 0.23055);
  near(r.quantity, 0.051);
  near(r.avgEntryPrice, 29.05735 / 0.051); // true average of the remaining fills
  near(r.price, ((29.05735 - 0.23055) / 0.051) * 1.004); // bank pulls the exit down
});

test('short: banked scalp profit raises the buyback exit', () => {
  const r = rebalanceClose([{ executedQty: 2, cummulativeQuoteQty: 200 }], [], 'short', 0.4, 1);
  near(r.avgEntryPrice, 100);
  near(r.price, ((200 + 1) / 2) * 0.996); // mirrored: exit moves up toward the market
});

test('bank covering the whole remaining cost → discount skipped, not a zero price', () => {
  const entries = [{ executedQty: 1, cummulativeQuoteQty: 100 }];
  const r = rebalanceClose(entries, [], 'long', 0.45, 100);
  near(r.price, 100 * 1.0045); // falls back to the unadjusted exit
  const r2 = rebalanceClose(entries, [], 'long', 0.45, 150);
  near(r2.price, 100 * 1.0045);
});

test('bank omitted or zero — behaviour identical to before', () => {
  const entries = [{ executedQty: 1, cummulativeQuoteQty: 100 }];
  near(rebalanceClose(entries, [], 'long', 0.45).price, 100.45);
  near(rebalanceClose(entries, [], 'long', 0.45, 0).price, 100.45);
});
