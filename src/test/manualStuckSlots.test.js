const test = require('node:test');
const assert = require('node:assert/strict');
const { manualStuckSlots } = require('../modules/jsonTimerSender');

// DEEP_ANALYSIS_PLAN.md Item 10 (risk #4) — manualStuckSlots.
// A slot the user pulled (CANCELED + manual) and never re-placed is left untouched
// by the engine, so the position stays open. This pure helper lists such slots so
// readLoop can periodically remind. A slot being re-placed (in manualReplaces) is
// excluded — it is about to lose `manual`. Pure unit, no exchange.

const map = (...idx) => new Map(idx.map((i) => [i, true]));

test('lists CANCELED + manual slots on both sides', () => {
  const obj = {
    BUY: [
      { status: 'FILLED', manual: true }, // filled, not stuck
      { status: 'CANCELED', manual: true }, // stuck
      { status: 'CANCELED' }, // bot-cancelled, no manual → not stuck
    ],
    SELL: [{ status: 'CANCELED', manual: true }], // stuck
  };
  assert.deepEqual(manualStuckSlots(obj), [
    { side: 'BUY', index: 1 },
    { side: 'SELL', index: 0 },
  ]);
});

test('NEW + manual (not yet cancelled) is NOT stuck', () => {
  const obj = { BUY: [{ status: 'NEW', manual: true }], SELL: [] };
  assert.deepEqual(manualStuckSlots(obj), []);
});

test('slot being re-placed (in pending) is excluded', () => {
  const obj = { BUY: [{ status: 'CANCELED', manual: true }], SELL: [] };
  const pending = { BUY: map(0), SELL: new Map() };
  assert.deepEqual(manualStuckSlots(obj, pending), []);
});

test('no manual slots → empty', () => {
  const obj = {
    BUY: [{ status: 'FILLED' }, { status: 'NEW' }],
    SELL: [{ status: 'CANCELED' }],
  };
  assert.deepEqual(manualStuckSlots(obj), []);
});

test('missing / non-array sides → empty, no throw', () => {
  assert.deepEqual(manualStuckSlots({}), []);
  assert.deepEqual(manualStuckSlots(null), []);
  assert.deepEqual(manualStuckSlots({ BUY: 'nope', SELL: undefined }), []);
});
