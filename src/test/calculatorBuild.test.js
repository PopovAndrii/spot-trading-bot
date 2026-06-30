const test = require('node:test');
const assert = require('node:assert/strict');
const { Calculator } = require('../lib/calculator');

// DEEP_ANALYSIS_PLAN.md §7a — constructor antipattern.
// The constructor used to return an array (`return this.factory()`), so
// `new Calculator()` yielded the grid instead of a Calculator — instanceof broke.
// Now the grid is built by the static build(); the constructor returns a normal instance.

const settings = {
  'field-currency': 100,
  'field-deposit': 1000,
  'field-orderSize': 1,
  'field-profit': 0.1,
  'field-commission': 0.2,
  'field-fibonachiStep': 0.2,
  'field-martingail': 49,
  'field-indent': 0,
  'field-activeOrders': 3,
  'field-stepSize': 3,
  'field-tickSize': 2,
};

test('new Calculator() returns a real instance (instanceof works)', () => {
  const c = new Calculator(settings);
  assert.ok(c instanceof Calculator);
  assert.equal(typeof c.factory, 'function');
  assert.ok(c.data); // constructor only prepared params, did not build the grid
});

test('Calculator.build() returns the grid array (long)', () => {
  const grid = Calculator.build(settings, 'long');
  assert.ok(Array.isArray(grid));
  assert.ok(grid.length > 0);
  for (const row of grid) {
    assert.ok('buy' in row && 'totalSell' in row);
    assert.ok('buyCurrency' in row && 'sellCurrency' in row);
  }
});

test('build() === new + factory() (same grid, only entry point changed)', () => {
  const viaBuild = Calculator.build(settings, 'long');
  const viaFactory = new Calculator(settings).factory('long');
  assert.deepEqual(viaBuild, viaFactory);
});

test('build() defaults to long; short builds a (mirror) grid too', () => {
  assert.deepEqual(Calculator.build(settings), Calculator.build(settings, 'long'));
  assert.ok(Array.isArray(Calculator.build(settings, 'short')));
});
