const test = require('node:test');
const assert = require('node:assert/strict');
const { strategyConflict } = require('../modules/jsonTimerSender');

// Seen live: a SHORT cycle was saved (its entry sold, its buy-back resting). The
// user picked Long in the UI and pressed Start. The engine took the strategy from
// the toggle and ran LONG over the SHORT's table — the short's buy-back, sitting on
// the BUY side, read as an entry buy — while the table redrew from the file and the
// toggle snapped back to Short on its own.
//
// The rule: a cycle's strategy belongs to the grid on disk. The toggle does not get
// to disagree with it. Refuse the start; never trade one side over the other's table.

test('saved SHORT, asked for LONG → refused', () => {
  const msg = strategyConflict('short', 'long');
  assert.ok(msg, 'the start must be refused');
  assert.match(msg, /SHORT/);
});

test('saved LONG, asked for SHORT → refused', () => {
  assert.ok(strategyConflict('long', 'short'));
});

test('they agree → started', () => {
  assert.equal(strategyConflict('long', 'long'), null);
  assert.equal(strategyConflict('short', 'short'), null);
});

test('no grid on disk → nothing to conflict with, any strategy starts', () => {
  assert.equal(strategyConflict(null, 'long'), null);
  assert.equal(strategyConflict(undefined, 'short'), null);
});

test('a junk value on disk is not a veto — it is not a cycle', () => {
  assert.equal(strategyConflict('', 'long'), null);
  assert.equal(strategyConflict('LONG', 'long'), null); // not the stored form
});
