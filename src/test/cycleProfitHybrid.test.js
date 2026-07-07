const test = require('node:test');
const assert = require('node:assert/strict');
const { cycleProfit } = require('../modules/jsonTimerSender');
const { bankGridLeg } = require('../lib/job');

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

test('v2 reconciliation: banked micros + whole-position exit == exchange net quote flow', () => {
  // Simulate a full hybrid v2 cycle against an explicit exchange ledger.
  // Base rung 0: buy 1.0 @ 100. Grid rung 1: bought three times @ 90, micro-sold
  // twice @ 90.27 (two banked oscillations), third buy closed by the exit.
  const ledger = { buys: 0, sells: 0 };
  const obj = {
    BUY: [
      { status: 'FILLED', executedQty: 1.0, cummulativeQuoteQty: 100 },
      { status: null, quantity: '1.000', price: '90.00' },
    ],
    SELL: [{ status: null }, { status: null, quantity: '1.000', price: '90.27' }],
  };
  ledger.buys += 100;

  for (let osc = 0; osc < 2; osc++) {
    Object.assign(obj.BUY[1], { status: 'FILLED', executedQty: 1.0, cummulativeQuoteQty: 90 });
    Object.assign(obj.SELL[1], {
      status: 'FILLED',
      executedQty: 1.0,
      cummulativeQuoteQty: 90.27,
      role: 'micro',
    });
    ledger.buys += 90;
    ledger.sells += 90.27;
    bankGridLeg(obj, 1, 'long'); // engine REARM handler
  }
  assert.equal(obj.SELL[1].hybrid, 2); // rung #2's micro fired twice

  // third re-buy of the frontier rung, then P ≥ T_F → exit close over the whole
  // position (2.0 @ 95.38) fills → DONE
  Object.assign(obj.BUY[1], { status: 'FILLED', executedQty: 1.0, cummulativeQuoteQty: 90 });
  Object.assign(obj.SELL[1], {
    status: 'FILLED',
    executedQty: 2.0,
    cummulativeQuoteQty: 190.76,
    role: 'exit',
  });
  ledger.buys += 90;
  ledger.sells += 190.76;

  const exchangeNet = ledger.sells - ledger.buys; // 371.3 − 370 = 1.3
  assert.equal(Number(cycleProfit(obj).toFixed(4)), Number(exchangeNet.toFixed(4)));
  assert.equal(Number(cycleProfit(obj).toFixed(4)), 1.3);
});
