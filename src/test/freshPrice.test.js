const test = require('node:test');
const assert = require('node:assert/strict');
const { freshPrice } = require('../modules/jsonTimerSender');

// Live price plumbing for the hybrid frontier: the stream cache is trusted only
// while fresh; anything else returns null so the engine falls back to a
// bookTicker request (and the Job stays in grid mode on total failure).

const NOW = 1_750_000_000_000;

test('fresh tick within maxAge → the cached price', () => {
  assert.equal(freshPrice(592.21, NOW - 1_000, NOW), 592.21);
  assert.equal(freshPrice('592.21', NOW - 9_999, NOW), 592.21); // string from the stream
});

test('stale tick (older than maxAge) → null', () => {
  assert.equal(freshPrice(592.21, NOW - 10_001, NOW), null);
  assert.equal(freshPrice(592.21, NOW - 60_000, NOW), null);
});

test('custom maxAge is honored', () => {
  assert.equal(freshPrice(592.21, NOW - 4_000, NOW, 5_000), 592.21);
  assert.equal(freshPrice(592.21, NOW - 6_000, NOW, 5_000), null);
});

test('no tick ever cached (ts 0 / price null) → null', () => {
  assert.equal(freshPrice(null, 0, NOW), null);
  assert.equal(freshPrice(592.21, 0, NOW), null);
});

test('garbage price (NaN, 0, negative) → null', () => {
  assert.equal(freshPrice('abc', NOW, NOW), null);
  assert.equal(freshPrice(0, NOW, NOW), null);
  assert.equal(freshPrice(-1, NOW, NOW), null);
});
