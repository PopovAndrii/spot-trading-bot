const test = require('node:test');
const assert = require('node:assert/strict');
const { cycleProfit } = require('../modules/jsonTimerSender');

// cycleProfit = Σ(SELL filled quote) − Σ(BUY filled quote) + obj.gridRealized.
// The gridRealized term matters because a re-armed grid leg has its fills cleared
// (rearmGridLeg), so its banked profit is no longer visible in the BUY/SELL sums.

test('plain DCA cycle (no grid): sell quote − buy quote', () => {
  const obj = {
    BUY: [{ status: 'FILLED', cummulativeQuoteQty: 100 }],
    SELL: [{ status: 'FILLED', cummulativeQuoteQty: 100.3 }],
  };
  assert.equal(Number(cycleProfit(obj).toFixed(4)), 0.3);
});

test('gridRealized is folded into the reported profit', () => {
  const obj = {
    BUY: [{ status: 'FILLED', cummulativeQuoteQty: 100 }],
    SELL: [{ status: 'FILLED', cummulativeQuoteQty: 100.3 }],
    gridRealized: 1.25, // several banked grid oscillations, fills already reset
  };
  assert.equal(Number(cycleProfit(obj).toFixed(4)), 1.55);
});

test('grid-only profit (re-armed legs have no live fills)', () => {
  // every leg re-armed → BUY/SELL carry no FILLED fills, all profit is in gridRealized
  const obj = {
    BUY: [{ status: null }, { status: 'NEW' }],
    SELL: [{ status: null }, { status: null }],
    gridRealized: 0.9,
  };
  assert.equal(Number(cycleProfit(obj).toFixed(4)), 0.9);
});

test('missing/invalid gridRealized → treated as 0', () => {
  const obj = {
    BUY: [{ status: 'FILLED', cummulativeQuoteQty: 50 }],
    SELL: [{ status: 'FILLED', cummulativeQuoteQty: 50.2 }],
    gridRealized: 'oops',
  };
  assert.equal(Number(cycleProfit(obj).toFixed(4)), 0.2);
});
