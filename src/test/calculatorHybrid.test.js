const test = require('node:test');
const assert = require('node:assert/strict');
const { Calculator, gridExitThreshold } = require('../lib/calculator');

// Hybrid DCA/GRID: when field-hybrid is 'on', every grid row gains a per-rung
// micro take-profit (long: microSellCurrency, short: microBuyCurrency) equal to
// the rung's OWN entry price marked up/down by microProfit + commission. With
// hybrid off the output must stay byte-for-byte identical (the DCA path is
// untouched) — that invariant is pinned here and by calculatorGolden.test.js.

const base = {
  'field-currency': 100,
  'field-deposit': 1000,
  'field-orderSize': 1,
  'field-profit': 0.1,
  'field-commission': 0.2,
  'field-fibonachiStep': 0.2,
  'field-martingail': 49,
  'field-indent': 0,
  'field-stepSize': 3,
  'field-tickSize': 2,
};

test('hybrid off: no micro field, output identical to a plain build', () => {
  const plain = Calculator.build(base, 'long');
  const explicitOff = Calculator.build({ ...base, 'field-hybrid': 'off' }, 'long');
  assert.deepEqual(explicitOff, plain);
  for (const row of plain) {
    assert.ok(!('microSellCurrency' in row));
    assert.ok(!('microBuyCurrency' in row));
  }
});

test('hybrid on (long): each rung gets microSellCurrency = entry * (1 + (microProfit+commission)/100)', () => {
  const microProfit = 0.1;
  const commission = base['field-commission'];
  const grid = Calculator.build(
    { ...base, 'field-hybrid': 'on', 'field-microProfit': microProfit },
    'long'
  );
  assert.ok(grid.length > 0);
  for (const row of grid) {
    assert.ok('microSellCurrency' in row);
    const entry = Number(row.buyCurrency);
    const expected = (entry * (1 + (microProfit + commission) / 100)).toFixed(
      base['field-tickSize']
    );
    assert.equal(row.microSellCurrency, expected);
    // A grid leg must close ABOVE its own entry (net of fees) or it loses money.
    assert.ok(
      Number(row.microSellCurrency) > entry,
      `micro ${row.microSellCurrency} <= entry ${entry}`
    );
  }
});

test('hybrid on (short): each rung gets microBuyCurrency = entry * (1 - (microProfit+commission)/100)', () => {
  const microProfit = 0.1;
  const commission = base['field-commission'];
  const grid = Calculator.build(
    { ...base, 'field-hybrid': 'on', 'field-microProfit': microProfit },
    'short'
  );
  assert.ok(grid.length > 0);
  for (const row of grid) {
    assert.ok('microBuyCurrency' in row);
    const entry = Number(row.sellCurrency);
    const expected = (entry * (1 - (microProfit + commission) / 100)).toFixed(
      base['field-tickSize']
    );
    assert.equal(row.microBuyCurrency, expected);
    // A grid leg must buy back BELOW its own sell entry (net of fees).
    assert.ok(
      Number(row.microBuyCurrency) < entry,
      `micro ${row.microBuyCurrency} >= entry ${entry}`
    );
  }
});

test('microProfit defaults to 0.1 when the field is omitted', () => {
  const commission = base['field-commission'];
  const grid = Calculator.build({ ...base, 'field-hybrid': 'on' }, 'long');
  const entry = Number(grid[0].buyCurrency);
  const expected = (entry * (1 + (0.1 + commission) / 100)).toFixed(base['field-tickSize']);
  assert.equal(grid[0].microSellCurrency, expected);
});

test("hybrid accepts boolean true as well as 'on'", () => {
  const asString = Calculator.build({ ...base, 'field-hybrid': 'on' }, 'long');
  const asBool = Calculator.build({ ...base, 'field-hybrid': true }, 'long');
  assert.deepEqual(asBool, asString);
});

// ===== gridExitThreshold: interpolation between S_{F-1} and S_F =====

test('gridExitThreshold: 50% → midpoint (spec default T = (S_F + S_{F-1}) / 2)', () => {
  // long: S_F (with the deeper rung averaged in) sits BELOW S_{F-1}
  assert.equal(gridExitThreshold(101, 99, 50), 100);
});

test('gridExitThreshold: 0% sticks to S_{F-1}, 100% to S_F', () => {
  assert.equal(gridExitThreshold(101, 99, 0), 101);
  assert.equal(gridExitThreshold(101, 99, 100), 99);
});

test('gridExitThreshold: short mirror (S_F above S_{F-1}) interpolates the same way', () => {
  assert.equal(gridExitThreshold(99, 101, 50), 100);
  assert.equal(gridExitThreshold(99, 101, 25), 99.5);
});

test('gridExitThreshold: invalid/missing pct falls back to 50', () => {
  assert.equal(gridExitThreshold(101, 99, undefined), 100);
  assert.equal(gridExitThreshold(101, 99, 'abc'), 100);
  assert.equal(gridExitThreshold(101, 99, null), 100); // Number(null) = 0 would be wrong
});

test('gridExitThreshold: string prices (as stored in config) are handled', () => {
  assert.equal(gridExitThreshold('594.52', '592.10', 50), 593.31);
});
